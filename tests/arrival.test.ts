import { describe, expect, it } from 'vitest'
import { arrivalRecord, rescheduledArrival, runBooking } from '../src/lib/arrival'
import type { TimingView } from '../src/lib/train/policy'

const booked = new Date('2026-09-21T16:11:00Z') // 9:41 pm IST
const at = (min: number) => new Date(booked.getTime() + min * 60_000)

function live(over: Partial<TimingView> = {}): TimingView {
  return {
    effectiveArrival: at(314), // 2:55 am, the case in the screenshot
    scheduledArrival: booked,
    source: 'LIVE',
    delayMinutes: 0,
    platform: null,
    ageMinutes: 2,
    stale: false,
    providerUpdatedAt: null,
    ...over,
  } as TimingView
}

describe('arrivalRecord', () => {
  describe('open, with a fresh live reading', () => {
    it('shows the expected time, as an estimate, measured against the booking', () => {
      const r = arrivalRecord({ status: 'PREPARED', scheduledArrival: booked }, live())
      expect(r).toMatchObject({ kind: 'expected', certainty: 'estimate', minutesVsBooked: 314, direction: 'later' })
      expect(r.time).toEqual(at(314))
    })

    it('flags a move even when the railway calls the train on time', () => {
      // delayMinutes is 0 here: the aggregator's booked time was simply wrong.
      expect(arrivalRecord({ status: 'RECEIVED', scheduledArrival: booked }, live()).direction).toBe('later')
    })

    it('says earlier when the train now comes sooner, the risky case for the kitchen', () => {
      const r = arrivalRecord({ status: 'ACCEPTED', scheduledArrival: booked }, live({ effectiveArrival: at(-20) }))
      expect(r.direction).toBe('earlier')
    })

    it('ignores a move under five minutes', () => {
      const r = arrivalRecord({ status: 'ACCEPTED', scheduledArrival: booked }, live({ effectiveArrival: at(3) }))
      expect(r.direction).toBeNull()
    })
  })

  describe('open, and the train has already arrived', () => {
    it('says Arrived, as a fact, not "expected" at a time already gone', () => {
      const r = arrivalRecord({ status: 'PREPARED', scheduledArrival: booked }, live({ arrived: true } as Partial<TimingView>))
      expect(r).toMatchObject({ kind: 'arrived', certainty: 'fact', direction: 'later' })
      expect(r.time).toEqual(at(314))
    })

    it('holds even when the reading is old, since an arrived train is never polled again', () => {
      const r = arrivalRecord(
        { status: 'PREPARED', scheduledArrival: booked },
        live({ arrived: true, stale: false, ageMinutes: 240 } as Partial<TimingView>),
      )
      expect(r.kind).toBe('arrived')
    })
  })

  describe('open, with no usable reading', () => {
    it('falls back to the booked time, marked unverified, when the reading is stale', () => {
      const r = arrivalRecord({ status: 'PREPARED', scheduledArrival: booked }, live({ stale: true }))
      expect(r).toMatchObject({ kind: 'booked', certainty: 'unverified', direction: null })
      expect(r.time).toEqual(booked)
    })

    it('does the same with no reading at all', () => {
      expect(arrivalRecord({ status: 'RECEIVED', scheduledArrival: booked }, null)).toMatchObject({
        kind: 'booked',
        certainty: 'unverified',
      })
    })
  })

  describe('delivered', () => {
    it('shows when the food actually arrived, as a fact, ignoring any live reading', () => {
      const r = arrivalRecord(
        { status: 'DELIVERED', scheduledArrival: booked, delivery: { deliveredAt: at(317) } },
        live({ stale: true, effectiveArrival: at(100) }),
      )
      expect(r).toMatchObject({ kind: 'delivered', certainty: 'fact', minutesVsBooked: 317, direction: 'later' })
      expect(r.time).toEqual(at(317))
    })

    it('stays correct after the live reading has been pruned', () => {
      // The reason delivered orders read deliveredAt and never the cache.
      const r = arrivalRecord({ status: 'DELIVERED', scheduledArrival: booked, delivery: { deliveredAt: at(317) } }, null)
      expect(r.time).toEqual(at(317))
    })
  })

  describe('closed any other way', () => {
    it('shows the booked time as context for a cancelled order, whatever the cache says', () => {
      const r = arrivalRecord({ status: 'CANCELLED', scheduledArrival: booked }, live())
      expect(r).toMatchObject({ kind: 'booked', certainty: 'context', direction: null })
      expect(r.time).toEqual(booked)
    })

    it('treats an admin custom status as closed', () => {
      expect(arrivalRecord({ status: 'REFUND', scheduledArrival: booked }, live()).certainty).toBe('context')
    })
  })

  it('returns no time when the order carries none', () => {
    expect(arrivalRecord({ status: 'RECEIVED', scheduledArrival: null }, null).time).toBeNull()
  })
})

describe('arrivalRecord: an ETA that has gone by', () => {
  it('marks an unconfirmed ETA in the past as past due, and one in the future as not', () => {
    const order = { status: 'PREPARED', scheduledArrival: booked }
    expect(arrivalRecord(order, live(), at(400)).pastDue).toBe(true)
    expect(arrivalRecord(order, live(), at(100)).pastDue).toBe(false)
  })

  it('never calls a confirmed arrival past due', () => {
    const order = { status: 'PREPARED', scheduledArrival: booked }
    expect(arrivalRecord(order, live({ arrived: true } as Partial<TimingView>), at(400)).pastDue).toBe(false)
  })
})

describe('rescheduledArrival', () => {
  const ist = (s: string) => new Date(`${s}+05:30`)

  it('moves a booking the railway timetable puts on the evening before', () => {
    // 15565 at CNB: booked 00:02 on the 30th, timetabled 23:40 on the 29th.
    expect(rescheduledArrival(ist('2026-10-30T00:02:00'), ist('2026-10-29T23:40:00')))
      .toEqual(ist('2026-10-29T23:40:00'))
  })

  it('moves a booking the timetable puts just past midnight', () => {
    expect(rescheduledArrival(ist('2026-10-29T23:50:00'), ist('2026-10-30T00:10:00')))
      .toEqual(ist('2026-10-30T00:10:00'))
  })

  it('leaves a same-day drift alone, so booked-vs-expected still shows it', () => {
    expect(rescheduledArrival(ist('2026-10-30T00:02:00'), ist('2026-10-30T00:20:00'))).toBeNull()
  })

  it('refuses a timetable too far from the booking to be a stale copy of it', () => {
    expect(rescheduledArrival(ist('2026-10-30T06:30:00'), ist('2026-10-29T23:40:00'))).toBeNull()
    expect(rescheduledArrival(ist('2026-10-30T00:02:00'), ist('2026-10-29T11:40:00'))).toBeNull()
  })

  it('still measures an order the railway moved against what was booked', () => {
    // Moved onto 23:40 on the 29th; the aggregator said 00:02 on the 30th.
    const r = arrivalRecord(
      { status: 'RECEIVED', scheduledArrival: ist('2026-10-29T23:40:00'), bookedArrival: ist('2026-10-30T00:02:00') },
      live({ effectiveArrival: ist('2026-10-30T00:34:00'), scheduledArrival: ist('2026-10-29T23:40:00') }),
      ist('2026-10-29T23:00:00'),
    )
    expect(r.booked).toEqual(ist('2026-10-30T00:02:00'))
    expect(r.minutesVsBooked).toBe(32)
  })

  it('shows the moved time, not the booking, when nothing live is known', () => {
    const r = arrivalRecord(
      { status: 'RECEIVED', scheduledArrival: ist('2026-10-29T23:40:00'), bookedArrival: ist('2026-10-30T00:02:00') },
      null,
    )
    expect(r.time).toEqual(ist('2026-10-29T23:40:00'))
  })

  it('has nothing to move without both times', () => {
    expect(rescheduledArrival(null, ist('2026-10-29T23:40:00'))).toBeNull()
    expect(rescheduledArrival(ist('2026-10-30T00:02:00'), null)).toBeNull()
  })
})

describe('runBooking', () => {
  const ist = (s: string) => new Date(`${s}+05:30`)

  it('takes the earliest booking that is not long gone', () => {
    // Last night's 23:40, still open at 8pm, beside tonight's 23:40.
    const now = ist('2026-10-30T20:00:00')
    expect(runBooking([ist('2026-10-29T23:40:00'), ist('2026-10-30T23:40:00')], now))
      .toEqual(ist('2026-10-30T23:40:00'))
  })

  it('falls back to the earliest when every booking is long gone', () => {
    const now = ist('2026-10-31T20:00:00')
    expect(runBooking([ist('2026-10-30T23:40:00'), null, ist('2026-10-29T23:40:00')], now))
      .toEqual(ist('2026-10-29T23:40:00'))
  })

  it('has nothing to go on without a booking', () => {
    expect(runBooking([null, undefined], new Date())).toBeNull()
  })
})
