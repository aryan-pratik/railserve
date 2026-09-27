import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { RiderLocation } from '../src/lib/models'
import { recordFixes, riderBoard } from '../src/lib/repo/riderLocationRepo'
import {
  TRAIL_MAX_POINTS,
  ageLabel,
  headingLabel,
  presenceOf,
  speedLabel,
} from '../src/lib/riderLocation'
import { issueMobileToken } from '../src/lib/mobile/token'
import { POST as postLocation } from '../src/app/api/mobile/location/route'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import type { LocationFix } from '../src/lib/riderLocation'
import type { AuthContext } from '../src/lib/authContext'

/** Kanpur Central, roughly. Any two distinguishable points would do. */
const PLATFORM: [number, number] = [26.4499, 80.3319]

function fix(atMsFromNow: number, over: Partial<LocationFix> = {}): LocationFix {
  return {
    lat: PLATFORM[0],
    lng: PLATFORM[1],
    accuracyMetres: 12,
    speedMetresPerSecond: 1.2,
    headingDegrees: 90,
    recordedAt: new Date(Date.now() + atMsFromNow),
    ...over,
  }
}

describe('presence grading', () => {
  const now = new Date('2026-09-27T10:00:00Z')

  it('grades a fresh fix live, a few minutes idle, and older offline', () => {
    expect(presenceOf(new Date(now.getTime() - 5_000), now)).toBe('LIVE')
    // The live window is an absolute 45s, not a multiple of the 5s send
    // interval — a phone on a platform drops signal for half a minute often
    // enough that tying the two together would flag working riders as idle.
    expect(presenceOf(new Date(now.getTime() - 44_000), now)).toBe('LIVE')
    expect(presenceOf(new Date(now.getTime() - 46_000), now)).toBe('IDLE')
    expect(presenceOf(new Date(now.getTime() - 9 * 60_000), now)).toBe('IDLE')
    expect(presenceOf(new Date(now.getTime() - 30 * 60_000), now)).toBe('OFFLINE')
  })

  it('separates "never shared" from "offline"', () => {
    expect(presenceOf(null, now)).toBe('NEVER')
    expect(presenceOf(undefined, now)).toBe('NEVER')
  })
})

describe('reading a fix out loud', () => {
  it('calls a GPS jitter stationary rather than reporting 0.9 km/h', () => {
    expect(speedLabel(0.1)).toBe('Stationary')
    expect(speedLabel(1.4)).toBe('5.0 km/h')
    expect(speedLabel(null)).toBeNull()
    // Android reports a negative speed when it has none.
    expect(speedLabel(-1)).toBeNull()
  })

  it('turns a bearing into a compass point, wrapping at 360', () => {
    expect(headingLabel(0)).toBe('N')
    expect(headingLabel(90)).toBe('E')
    expect(headingLabel(359)).toBe('N')
    expect(headingLabel(-90)).toBe('W')
    expect(headingLabel(null)).toBeNull()
  })

  it('ages a timestamp in the units a person reads', () => {
    const now = new Date('2026-09-27T10:00:00Z')
    expect(ageLabel(new Date(now.getTime() - 3_000), now)).toBe('just now')
    expect(ageLabel(new Date(now.getTime() - 40_000), now)).toBe('40s ago')
    expect(ageLabel(new Date(now.getTime() - 8 * 60_000), now)).toBe('8m ago')
    expect(ageLabel(new Date(now.getTime() - 3 * 3_600_000), now)).toBe('3h ago')
    expect(ageLabel(null, now)).toBe('')
  })
})

describe('recording fixes from a phone', () => {
  let riderId: mongoose.Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const rider = await makeUser('DELIVERY_AGENT', '9100000001')
    riderId = rider._id
  })

  const stored = () => RiderLocation.findOne({ userId: riderId }).lean()

  it('creates the rider row on the first batch, trail and all', async () => {
    await recordFixes(riderId, [fix(-30_000), fix(-20_000, { lat: 26.45 })])
    const row = await stored()
    expect(row?.lat).toBe(26.45)
    expect(row?.trail).toHaveLength(2)
    expect(row?.accuracyMetres).toBe(12)
  })

  it('does not rewind when a reconnecting phone flushes older fixes', async () => {
    const before = await stored()
    // The classic case: no signal in the station, then a dump of stale fixes
    // that arrive after a newer one already got through.
    await recordFixes(riderId, [fix(-300_000, { lat: 1.111 }), fix(-290_000, { lat: 2.222 })])
    const after = await stored()
    expect(after?.lat).toBe(before?.lat)
    expect(after?.recordedAt.getTime()).toBe(before?.recordedAt.getTime())
    // And nothing stale joined the drawn path either.
    expect(after?.trail.some((p) => p.lat === 1.111)).toBe(false)
  })

  it('is safe to replay the same batch twice', async () => {
    const batch = [fix(-5_000, { lat: 26.4601 })]
    await recordFixes(riderId, batch)
    const once = await stored()
    await recordFixes(riderId, batch)
    const twice = await stored()
    expect(twice?.lat).toBe(26.4601)
    expect(twice?.trail).toHaveLength(once!.trail.length)
  })

  it('advances on a batch that is newer, in time order whatever order it arrives', async () => {
    await recordFixes(riderId, [
      fix(-1_000, { lat: 26.47 }),
      fix(-3_000, { lat: 26.46 }),
      fix(-2_000, { lat: 26.465 }),
    ])
    const row = await stored()
    expect(row?.lat).toBe(26.47)
    const tail = row!.trail.slice(-3).map((p) => p.lat)
    expect(tail).toEqual([26.46, 26.465, 26.47])
  })

  it('clamps a fix from a phone whose clock runs fast, rather than wedging the row', async () => {
    // A future stamp stored as-is would make every later fix "older" and stick
    // the rider on the map forever.
    const { storedAt } = await recordFixes(riderId, [fix(60 * 60_000, { lat: 26.48 })])
    expect(storedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1_000)

    await recordFixes(riderId, [fix(1_000, { lat: 26.49 })])
    expect((await stored())?.lat).toBe(26.49)
  })

  it('drops yesterday’s walk and a failed fix at Null Island', async () => {
    const before = await stored()
    const result = await recordFixes(riderId, [
      fix(-25 * 60 * 60_000, { lat: 26.5 }),
      fix(-1_000, { lat: 0, lng: 0 }),
    ])
    expect(result.accepted).toBe(0)
    expect((await stored())?.lat).toBe(before?.lat)
  })

  it('caps the trail so a long shift cannot grow the row without bound', async () => {
    const many = Array.from({ length: TRAIL_MAX_POINTS + 25 }, (_, i) =>
      fix(i * 100, { lat: 26.4 + i / 10_000 }),
    )
    await recordFixes(riderId, many)
    const row = await stored()
    expect(row?.trail).toHaveLength(TRAIL_MAX_POINTS)
    // What survived is the newest end of the walk, not the oldest.
    expect(row!.trail.at(-1)!.lat).toBeCloseTo(row!.lat, 6)
  })
})

describe('the admin board', () => {
  let admin: AuthContext
  let sharing: mongoose.Types.ObjectId
  let silent: mongoose.Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const outlet = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    admin = ctxFor(await makeUser('ADMIN', '9100000010'))
    sharing = (await makeUser('DELIVERY_AGENT', '9100000011', outlet._id))._id
    silent = (await makeUser('DELIVERY_AGENT', '9100000012', outlet._id))._id

    await recordFixes(sharing, [fix(-4_000)])

    await makeOrder({
      serviceDate: '2026-09-27',
      status: 'DISPATCHED',
      trainNo: '12801',
      restaurantId: outlet._id,
      delivery: { agentIds: [sharing], dispatchedAt: new Date() },
    })
    await makeOrder({
      serviceDate: '2026-09-27',
      status: 'DELIVERED',
      trainNo: '12802',
      restaurantId: outlet._id,
      delivery: { agentIds: [sharing], deliveredAt: new Date() },
    })
    // Another rider's work, so the per-rider grouping is actually exercised.
    await makeOrder({
      serviceDate: '2026-09-27',
      status: 'FAILED',
      restaurantId: outlet._id,
      delivery: { agentIds: [silent] },
    })
  })

  it('lists a rider who has never shared rather than hiding them', async () => {
    const board = await riderBoard(admin, { serviceDate: '2026-09-27' })
    const row = board.riders.find((r) => r.id === String(silent))
    expect(row).toBeDefined()
    expect(row?.presence).toBe('NEVER')
    expect(row?.position).toBeNull()
  })

  it('counts what each rider is carrying and has finished today', async () => {
    const board = await riderBoard(admin, { serviceDate: '2026-09-27' })
    const row = board.riders.find((r) => r.id === String(sharing))!
    expect(row.presence).toBe('LIVE')
    expect(row.work.carrying).toBe(1)
    expect(row.work.delivered).toBe(1)
    // Only the train still in their hands — the one already served is done.
    expect(row.work.trains).toEqual(['12801'])

    const other = board.riders.find((r) => r.id === String(silent))!
    expect(other.work.failed).toBe(1)
    expect(other.work.carrying).toBe(0)
  })

  it('puts the riders who need looking at first', async () => {
    const board = await riderBoard(admin, { serviceDate: '2026-09-27' })
    expect(board.riders[0].id).toBe(String(sharing))
  })

  it('counts nothing against a rider on a day they did not work', async () => {
    const board = await riderBoard(admin, { serviceDate: '2026-09-26' })
    const row = board.riders.find((r) => r.id === String(sharing))!
    expect(row.work.carrying).toBe(0)
    expect(row.work.delivered).toBe(0)
    // The position is not a service-day fact: it is still the last one known.
    expect(row.position).not.toBeNull()
  })
})

describe('the ingest route\u2019s gate', () => {
  let riderToken: string
  let managerToken: string

  beforeAll(async () => {
    await resetDb()
    const outlet = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    riderToken = issueMobileToken(await makeUser('DELIVERY_AGENT', '9100000021')).token
    managerToken = issueMobileToken(await makeUser('STORE_MANAGER', '9100000022', outlet._id)).token
  })

  const post = (token: string | null, body: unknown) =>
    postLocation(
      new Request('http://localhost/api/mobile/location', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    )

  const onePing = { pings: [{ lat: PLATFORM[0], lng: PLATFORM[1], recordedAt: new Date().toISOString() }] }

  it('refuses an unauthenticated caller', async () => {
    expect((await post(null, onePing)).status).toBe(401)
    expect((await post('not-a-token', onePing)).status).toBe(401)
  })

  it('refuses a signed-in user who is not a rider', async () => {
    // The bearer is genuine; the role is not. Without this check a manager's
    // phone would appear on the rider map.
    expect((await post(managerToken, onePing)).status).toBe(403)
  })

  it('takes a rider\u2019s batch', async () => {
    const res = await post(riderToken, onePing)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, accepted: 1 })
  })

  it('rejects a coordinate that is not one', async () => {
    for (const bad of [
      { pings: [] },
      { pings: [{ lat: 200, lng: 0, recordedAt: new Date().toISOString() }] },
      { pings: [{ lat: 26, lng: 80, recordedAt: 'yesterday' }] },
      { pings: [{ lng: 80, recordedAt: new Date().toISOString() }] },
      {},
    ]) {
      expect((await post(riderToken, bad)).status).toBe(400)
    }
  })
})

afterAll(async () => {
  await disconnectDb()
})
