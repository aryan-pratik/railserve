import { describe, expect, it } from 'vitest'
import { arrivalRecord } from '../src/lib/arrival'
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
