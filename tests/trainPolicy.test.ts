import { describe, expect, it } from 'vitest'
import {
  buildTimingView, computeDispatchAt, isStale, minutesBetween, pollIntervalMinutes,
  shouldWarnAboutDelay,
} from '../src/lib/train/policy'
import { SimulatedTrainStatusProvider } from '../src/lib/train/simulator'

const at = (iso: string) => new Date(iso)

describe('polling cadence (plan §8)', () => {
  it('tightens as the train approaches', () => {
    // Over two hours out: nothing is being decided, so ask rarely.
    expect(pollIntervalMinutes(180)).toBe(40)
    expect(pollIntervalMinutes(121)).toBe(40)
    // One to two hours: the kitchen decision is coming into view.
    expect(pollIntervalMinutes(120)).toBe(30)
    expect(pollIntervalMinutes(61)).toBe(30)
    // Inside the hour: cooking and dispatch both happen in here.
    expect(pollIntervalMinutes(60)).toBe(15)
    expect(pollIntervalMinutes(30)).toBe(15)
    expect(pollIntervalMinutes(0)).toBe(15)
  })

  it('keeps polling a train that has already arrived, at the tightest tier', () => {
    // Negative means the ETA has passed; the agent still needs platform updates.
    expect(pollIntervalMinutes(-10)).toBe(15)
  })

  it('falls back to the slowest tier when there is no time to reason about', () => {
    expect(pollIntervalMinutes(null)).toBe(40)
  })
})

describe('staleness', () => {
  const now = at('2026-08-27T10:00:00Z')

  it('treats a never-fetched row as stale', () => {
    // This is what makes a new order fetch on the very next tick: no row yet,
    // so the train is due immediately whatever tier it would sit on.
    expect(isStale(null, 20, now)).toBe(true)
    expect(isStale(null, 500, now)).toBe(true)
  })

  it('uses the tier that matches proximity', () => {
    // 20 minutes old: still fresh two hours out, stale inside the hour.
    const fetchedAt = at('2026-08-27T09:40:00Z')
    expect(isStale(fetchedAt, 180, now)).toBe(false)
    expect(isStale(fetchedAt, 30, now)).toBe(true)
  })

  it('never refetches an arrived train, however old the row is', () => {
    // Seen in production: trains that had departed CNB up to 13 hours earlier
    // were still being re-polled every 15 minutes, because staleness only
    // ever looked at age and proximity — never at whether the train itself
    // was done. A day-old row for an arrived train must stay "not stale"
    // forever, not just outlast one tier.
    const veryOld = at('2026-08-26T00:00:00Z')
    expect(isStale(veryOld, -800, now, true)).toBe(false)
  })

  it('still polls on the normal tier when the train has not been confirmed arrived', () => {
    // arrived defaults to false, so existing callers that do not know about
    // it behave exactly as before.
    const fetchedAt = at('2026-08-27T09:40:00Z')
    expect(isStale(fetchedAt, -800, now)).toBe(true)
  })
})

describe('dispatchAt (plan §9)', () => {
  it('works back from the ETA through the walk and the buffer', () => {
    const d = computeDispatchAt({
      etaAt: at('2026-08-27T13:25:00+05:30'),
      walkToPlatformMinutes: 10,
      bufferMinutes: 5,
    })
    // 13:25 minus 15 minutes = 13:10 IST
    expect(d!.toISOString()).toBe('2026-08-27T07:40:00.000Z')
  })

  it('moves later when the train is late — the whole point of live timing', () => {
    const onTime = computeDispatchAt({
      etaAt: at('2026-08-27T13:25:00+05:30'), walkToPlatformMinutes: 10, bufferMinutes: 5,
    })!
    const late = computeDispatchAt({
      etaAt: at('2026-08-27T14:45:00+05:30'), walkToPlatformMinutes: 10, bufferMinutes: 5,
    })!
    expect(minutesBetween(onTime, late)).toBe(80)
  })

  it('respects a slower walk at a bigger station', () => {
    const near = computeDispatchAt({
      etaAt: at('2026-08-27T13:25:00+05:30'), walkToPlatformMinutes: 10, bufferMinutes: 5,
    })!
    const far = computeDispatchAt({
      etaAt: at('2026-08-27T13:25:00+05:30'), walkToPlatformMinutes: 25, bufferMinutes: 5,
    })!
    expect(minutesBetween(far, near)).toBe(15)
  })

  it('returns null rather than inventing a time when there is no ETA', () => {
    expect(computeDispatchAt({ etaAt: null, walkToPlatformMinutes: 10, bufferMinutes: 5 })).toBeNull()
  })
})

describe('timing view', () => {
  const now = at('2026-08-27T10:00:00Z')
  const scheduled = at('2026-08-27T13:25:00+05:30')

  it('falls back to scheduled when nothing live is held', () => {
    const v = buildTimingView({ scheduledArrival: scheduled, reading: null, now })
    expect(v.source).toBe('SCHEDULED')
    expect(v.effectiveArrival).toEqual(scheduled)
    expect(v.stale).toBe(false)
  })

  it('prefers a live ETA over the scheduled time', () => {
    const eta = at('2026-08-27T14:45:00+05:30')
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: { etaAt: eta, delayMinutes: 80, platform: '3', fetchedAt: now },
      now,
    })
    expect(v.source).toBe('LIVE')
    expect(v.effectiveArrival).toEqual(eta)
    expect(v.delayMinutes).toBe(80)
    expect(v.platform).toBe('3')
    expect(v.stale).toBe(false)
    expect(v.ageMinutes).toBe(0)
  })

  it('reports when it last checked and when the next check is due', () => {
    // now is 10:00Z; an ETA of 11:25Z is 85 minutes out, which is the 30-minute
    // tier. Checked at 09:55Z, so due again at 10:25Z.
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: {
        etaAt: at('2026-08-27T11:25:00Z'),
        delayMinutes: 10,
        platform: '3',
        fetchedAt: at('2026-08-27T09:55:00Z'),
      },
      now,
    })
    expect(v.checkedAt).toEqual(at('2026-08-27T09:55:00Z'))
    expect(v.nextCheckAt).toEqual(at('2026-08-27T10:25:00Z'))
    // The UI and the poller must agree about when this row comes due.
    expect(v.stale).toBe(false)
  })

  it('gives the same due time the staleness check is about to apply', () => {
    // Inside the last hour the tier tightens to 15 minutes, so a reading taken
    // 20 minutes ago is already past due — and both fields must say so.
    const fetchedAt = at('2026-08-27T09:40:00Z')
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: {
        etaAt: at('2026-08-27T10:30:00Z'),
        delayMinutes: 0,
        platform: '1',
        fetchedAt,
      },
      now,
    })
    expect(v.nextCheckAt).toEqual(at('2026-08-27T09:55:00Z'))
    expect(v.nextCheckAt!.getTime()).toBeLessThan(now.getTime())
    expect(v.stale).toBe(true)
  })

  it('reports no next check for an arrived train, not a due time', () => {
    // A day-old reading would normally read as badly overdue. Arrived means
    // there is no "due" left to compute — nextCheckAt must be null, not a
    // time already far in the past, or the UI would show a countdown that
    // implies polling is still trying and failing.
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: {
        etaAt: at('2026-08-27T13:39:00+05:30'),
        delayMinutes: 4,
        platform: '2',
        fetchedAt: at('2026-08-26T09:00:00Z'),
        arrived: true,
      },
      now,
    })
    expect(v.arrived).toBe(true)
    expect(v.nextCheckAt).toBeNull()
    expect(v.stale).toBe(false)
    // The arrival itself is still reported — arrived does not mean unknown.
    expect(v.effectiveArrival).toEqual(at('2026-08-27T13:39:00+05:30'))
  })

  it('defaults arrived to false for a provider that does not report it', () => {
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: { etaAt: at('2026-08-27T14:45:00+05:30'), delayMinutes: 80, platform: '3', fetchedAt: now },
      now,
    })
    expect(v.arrived).toBe(false)
    expect(v.nextCheckAt).not.toBeNull()
  })

  it('has nothing to report about checking when no reading is held', () => {
    const v = buildTimingView({ scheduledArrival: scheduled, reading: null, now })
    expect(v.checkedAt).toBeNull()
    expect(v.nextCheckAt).toBeNull()
  })

  it('carries the feed\'s own update time through, separately from our fetch age', () => {
    // Two different ages: we asked just now, the railway last knew 40 minutes
    // ago. Only the second bounds the ETA, so it must survive to the UI.
    const feedAt = at('2026-08-27T12:45:00+05:30')
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: {
        etaAt: at('2026-08-27T14:45:00+05:30'),
        delayMinutes: 80,
        platform: '3',
        fetchedAt: now,
        providerUpdatedAt: feedAt,
      },
      now,
    })
    expect(v.ageMinutes).toBe(0)
    expect(v.providerUpdatedAt).toEqual(feedAt)
  })

  it('keeps a stale reading but flags it and reports its age', () => {
    // Plan §8: keep the last known value, mark it stale, show the age.
    // Never present a stale ETA as live.
    //
    // 22 minutes old, against a train already at the tightest 15-minute tier —
    // comfortably past due rather than a minute over, so the assertion is
    // about the flagging behaviour and not about where a tier boundary sits.
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: {
        etaAt: at('2026-08-27T14:45:00+05:30'),
        delayMinutes: 80,
        platform: '3',
        fetchedAt: at('2026-08-27T09:38:00Z'),
      },
      now,
    })
    expect(v.delayMinutes).toBe(80)
    expect(v.ageMinutes).toBe(22)
    expect(v.stale).toBe(true)
  })

  it('does not claim LIVE when the reading carried no usable ETA', () => {
    const v = buildTimingView({
      scheduledArrival: scheduled,
      reading: { etaAt: null, delayMinutes: null, platform: '4', fetchedAt: now },
      now,
    })
    expect(v.source).toBe('SCHEDULED')
    expect(v.effectiveArrival).toEqual(scheduled)
    expect(v.platform).toBe('4')
  })
})

describe('simulator', () => {
  const p = new SimulatedTrainStatusProvider(() => at('2026-08-27T13:25:00+05:30'))

  it('is deterministic, so a demo and a test agree', async () => {
    const a = await p.getStatus('12506', '2026-08-27', 'CNB')
    const b = await p.getStatus('12506', '2026-08-27', 'CNB')
    expect(a).toEqual(b)
  })

  it('varies by train, date and station', async () => {
    const a = await p.getStatus('12506', '2026-08-27', 'CNB')
    const b = await p.getStatus('12312', '2026-08-27', 'CNB')
    const c = await p.getStatus('12506', '2026-08-28', 'CNB')
    expect(new Set([a.delayMinutes, b.delayMinutes, c.delayMinutes]).size).toBeGreaterThan(1)
  })

  it('offsets the ETA by exactly the delay it reports', async () => {
    const r = await p.getStatus('12506', '2026-08-27', 'CNB')
    expect(minutesBetween(at('2026-08-27T13:25:00+05:30'), r.etaAt!)).toBe(r.delayMinutes)
  })

  it('produces enough badly-delayed trains to exercise the 45-minute KOT guard', async () => {
    const delays: number[] = []
    for (let i = 0; i < 60; i++) {
      const r = await p.getStatus(String(12000 + i), '2026-08-27', 'CNB')
      delays.push(r.delayMinutes!)
    }
    expect(delays.some((d) => d > 45)).toBe(true)
    expect(delays.some((d) => d < 10)).toBe(true)
  })
})

describe('KOT delay guard (plan §9)', () => {
  it('asks for confirmation past the threshold', () => {
    expect(shouldWarnAboutDelay(80, 45)).toBe(true)
    expect(shouldWarnAboutDelay(45, 45)).toBe(true)
  })

  it('stays out of the way for a normal delay', () => {
    expect(shouldWarnAboutDelay(44, 45)).toBe(false)
    expect(shouldWarnAboutDelay(0, 45)).toBe(false)
  })

  it('does not warn when the delay is unknown', () => {
    // A dialog that fires on missing data teaches people to click through
    // dialogs, which is worse than not asking.
    expect(shouldWarnAboutDelay(null, 45)).toBe(false)
  })

  it('respects a reconfigured threshold', () => {
    expect(shouldWarnAboutDelay(20, 15)).toBe(true)
    expect(shouldWarnAboutDelay(20, 30)).toBe(false)
  })
})
