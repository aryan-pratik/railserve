import { beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import { activityFeed, riderStatusCounts } from '../src/lib/repo/activityRepo'
import { ACTIVITY_KINDS, istDaysToRange, kindOf, panelOf } from '../src/lib/activity'
import { ForbiddenError, type AuthContext } from '../src/lib/authContext'

const DAY = '2026-10-20'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+05:30`)
const range = istDaysToRange(DAY, DAY)

type Ev = {
  fromStatus: string | null
  toStatus: string
  userId: mongoose.Types.ObjectId | null
  meta: Record<string, unknown>
  createdAt: Date
}

let admin: AuthContext
let ids: Record<'admin' | 'caller' | 'manager' | 'rider' | 'other', mongoose.Types.ObjectId>
/** Every event written below, so each test can check the feed against kindOf. */
const written: Ev[] = []

beforeAll(async () => {
  await resetDb()
  const outlet = await makeRestaurant('Activity Kitchen', 'CNB')
  const [a, c, m, r, o] = await Promise.all([
    makeUser('ADMIN', '9100000001'),
    makeUser('TELECALLER', '9100000002', outlet._id),
    makeUser('STORE_MANAGER', '9100000003', outlet._id),
    makeUser('DELIVERY_AGENT', '9100000004', outlet._id),
    makeUser('DELIVERY_AGENT', '9100000005', outlet._id),
  ])
  admin = ctxFor(a)
  ids = { admin: a._id, caller: c._id, manager: m._id, rider: r._id, other: o._id }

  const ev = (
    from: string | null,
    to: string,
    who: mongoose.Types.ObjectId | null,
    hhmm: string,
    meta: Record<string, unknown> = {},
  ): Ev => {
    const e = { fromStatus: from, toStatus: to, userId: who, meta, createdAt: at(hhmm) }
    written.push(e)
    return e
  }

  // One order the rider carried, end to end.
  await makeOrder({
    externalOrderId: 'ACT-1',
    restaurantId: outlet._id,
    status: 'DELIVERED',
    delivery: { agentIds: [r._id] },
    events: [
      ev(null, 'RECEIVED', null, '09:00', { action: 'CREATED', source: 'TEST' }),
      ev('RECEIVED', 'ACCEPTED', m._id, '09:05', { via: 'store-dashboard' }),
      ev('ACCEPTED', 'ACCEPTED', a._id, '09:06', {
        action: 'ASSIGN_AGENTS', agentIds: [String(r._id)], fromAgentIds: [], via: 'admin-detail',
      }),
      ev('ACCEPTED', 'ACCEPTED', a._id, '09:07', {
        action: 'FIELD_EDITED', field: 'remark', label: 'Remark', from: '', to: 'less spicy', via: 'admin-detail',
      }),
      ev('ACCEPTED', 'PREPARED', m._id, '09:30', { via: 'store-dashboard' }),
      ev('PREPARED', 'DISPATCHED', r._id, '09:40', { via: 'expo-app', clientId: 'x' }),
      ev('DISPATCHED', 'DELIVERED', r._id, '10:00', { via: 'expo-app', clientId: 'y' }),
      ev('DELIVERED', 'DELIVERED', m._id, '18:00', {
        action: 'COD_SETTLED', riderId: String(r._id), amountPaise: 12000, handoverPaise: 12000, handoverOrders: 1,
      }),
    ],
    callLog: [{ text: 'Passenger confirmed coach B2', userId: c._id, createdAt: at('09:20') }],
  })

  // Another rider's order, cancelled at the desk after a request.
  await makeOrder({
    externalOrderId: 'ACT-2',
    restaurantId: outlet._id,
    status: 'CANCELLED',
    delivery: { agentIds: [o._id] },
    events: [
      ev(null, 'RECEIVED', null, '11:00', { action: 'CREATED', source: 'TEST' }),
      ev('RECEIVED', 'RECEIVED', m._id, '11:10', { action: 'CANCEL_REQUESTED', reason: 'Out of paneer' }),
      ev('RECEIVED', 'CANCELLED', c._id, '11:15', { via: 'cancel-request', reason: 'Out of paneer' }),
      ev('RECEIVED', 'RECEIVED', null, '11:16', { action: 'LEAVE_NOW', trainNo: '12301' }),
      ev('CANCELLED', 'CANCELLED', o._id, '11:20', { via: 'agent-order', action: 'SOMETHING_NEW' }),
    ],
  })

  // The other rider's run: picked up on the web page, then one outcome
  // corrected in the app.
  await makeOrder({
    externalOrderId: 'ACT-4',
    restaurantId: outlet._id,
    status: 'FAILED',
    delivery: { agentIds: [o._id] },
    events: [
      ev('PREPARED', 'DISPATCHED', o._id, '12:00', { via: 'agent-web-run' }),
      ev('DISPATCHED', 'DELIVERED', o._id, '12:30', { via: 'agent-run' }),
      ev('DELIVERED', 'FAILED', o._id, '12:40', { via: 'rider-correction', reason: 'Passenger not found' }),
    ],
  })

  // Outside the day: must never appear in a one-day read.
  await makeOrder({
    externalOrderId: 'ACT-3',
    restaurantId: outlet._id,
    status: 'RECEIVED',
    events: [
      { fromStatus: null, toStatus: 'RECEIVED', userId: null, meta: { action: 'CREATED' }, createdAt: new Date('2026-10-19T23:00:00+05:30') },
    ],
  })
})

const read = (q: Partial<Parameters<typeof activityFeed>[1]> = {}) =>
  activityFeed(admin, { range, skip: 0, limit: 100, ...q })

describe('activityFeed', () => {
  it('lists every event and call note in the range, newest first, and nothing outside it', async () => {
    const feed = await read()
    expect(feed.total).toBe(written.length + 1)
    expect(feed.rows.map((r) => r.externalOrderId)).not.toContain('ACT-3')
    const times = feed.rows.map((r) => r.at.getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(feed.rows.find((r) => r.type === 'note')?.text).toBe('Passenger confirmed coach B2')
  })

  it('files each event under the kind kindOf gives it, and the filter agrees', async () => {
    for (const kind of ACTIVITY_KINDS) {
      const feed = await read({ kind })
      const expected =
        kind === 'CALL_NOTE' ? 1 : written.filter((e) => kindOf(e) === kind).length
      expect({ kind, n: feed.total }).toEqual({ kind, n: expected })
      for (const row of feed.rows) expect(row.kind).toBe(kind)
    }
  })

  it('names the screen from the role, splitting the rider app from rider web by via', async () => {
    const feed = await read()
    const counts = feed.panelCounts
    expect(counts).toEqual({
      ADMIN: 2,
      CALLS: 2, // the cancel, and the call note
      STORE: 4,
      RIDER_APP: 4, // two expo-app, an agent-run, a rider-correction
      RIDER_WEB: 2, // agent-order, agent-web-run
      SYSTEM: 3,
    })
    for (const panel of ['RIDER_APP', 'RIDER_WEB', 'SYSTEM', 'STORE'] as const) {
      const only = await read({ panel })
      expect(only.total).toBe(counts[panel])
      for (const row of only.rows) expect(row.panel).toBe(panel)
      // Tab counts are taken before the panel filter, so they do not change.
      expect(only.panelCounts).toEqual(counts)
    }
    expect(panelOf('DELIVERY_AGENT', 'expo-app')).toBe('RIDER_APP')
    expect(panelOf('DELIVERY_AGENT', 'agent-web-run')).toBe('RIDER_WEB')
    expect(panelOf(undefined, null)).toBe('SYSTEM')
  })

  it('filters to one person and to one order', async () => {
    const byManager = await read({ actorId: String(ids.manager) })
    expect(byManager.total).toBe(4)
    expect(byManager.rows.every((r) => r.actor?.id === String(ids.manager))).toBe(true)

    const one = await read({ orderId: '#act-2' })
    expect(new Set(one.rows.map((r) => r.externalOrderId))).toEqual(new Set(['ACT-2']))
  })

  it("gives a rider's record: their own actions and what was done to their deliveries", async () => {
    const feed = await activityFeed(admin, { range: null, riderId: String(ids.rider), skip: 0, limit: 100 })
    const what = feed.rows.map((r) => `${r.fromStatus}>${r.toStatus}:${String(r.meta.action ?? '')}`)
    expect(what.sort()).toEqual(
      [
        'ACCEPTED>ACCEPTED:ASSIGN_AGENTS', // assigned by the admin
        'PREPARED>DISPATCHED:', // picked up, in the app
        'DISPATCHED>DELIVERED:', // delivered, in the app
        'DELIVERED>DELIVERED:COD_SETTLED', // cash taken by the manager
      ].sort(),
    )
    // Kitchen work, edits and call notes are not the rider's.
    expect(feed.rows.some((r) => r.type === 'note')).toBe(false)
  })

  it('pages without repeating or dropping an entry', async () => {
    const all = await read()
    const seen: string[] = []
    for (let skip = 0; skip < all.total; skip += 4) {
      const page = await read({ skip, limit: 4 })
      seen.push(...page.rows.map((r) => r.id))
    }
    expect(seen).toEqual(all.rows.map((r) => r.id))
  })

  it('is admin only, and refuses an unbounded read', async () => {
    const manager: AuthContext = { userId: ids.manager, role: 'STORE_MANAGER', restaurantIds: [] }
    await expect(activityFeed(manager, { range, skip: 0, limit: 1 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(activityFeed(admin, { range: null, skip: 0, limit: 1 })).rejects.toThrow(/date range/)
  })
})

describe('riderStatusCounts', () => {
  it("counts a rider's orders by status, with the money on them", async () => {
    const rows = await riderStatusCounts(admin, ids.rider, {})
    expect(rows).toEqual([{ status: 'DELIVERED', orders: 1, amountPaise: 12000, codOrders: 1, codPaise: 12000 }])
  })
})
