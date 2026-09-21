import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ArrivalTime } from '../src/components/ArrivalTime'
import { arrivalRecord } from '../src/lib/arrival'
import type { TimingView } from '../src/lib/train/policy'

const booked = new Date('2026-09-21T16:11:00Z') // 9:41 pm IST
const at = (min: number) => new Date(booked.getTime() + min * 60_000)
const live = (over: Partial<TimingView> = {}) =>
  ({ effectiveArrival: at(314), scheduledArrival: booked, source: 'LIVE', delayMinutes: 0, platform: null, ageMinutes: 2, stale: false, providerUpdatedAt: null, ...over }) as TimingView

const html = (order: Parameters<typeof arrivalRecord>[0], timing: TimingView | null) =>
  renderToStaticMarkup(createElement(ArrivalTime, { record: arrivalRecord(order, timing) }))

/** Each channel carries one meaning: word = what it is, weight = how sure, hue = how far it moved. */
describe('ArrivalTime', () => {
  it('labels an expected time ETA, regular weight, amber when later than booked', () => {
    const out = html({ status: 'PREPARED', scheduledArrival: booked }, live())
    expect(out).toContain('>ETA<')
    expect(out).toContain('2:55 am')
    expect(out).toContain('text-amber-700')
    expect(out).not.toContain('font-semibold')
    expect(out).toContain('5h 14m later than booked')
  })

  it('uses blue for a train that now comes earlier', () => {
    expect(html({ status: 'PREPARED', scheduledArrival: booked }, live({ effectiveArrival: at(-20) }))).toContain('text-sky-700')
  })

  it('labels a delivery, bold because it is a recorded fact', () => {
    const out = html({ status: 'DELIVERED', scheduledArrival: booked, delivery: { deliveredAt: at(2) } }, null)
    expect(out).toContain('>Delivered<')
    expect(out).toContain('font-semibold')
    expect(out).not.toContain('amber') // two minutes after booking is on time
  })

  it('says Arrived, bold, once the railway confirms the train has passed', () => {
    const out = html({ status: 'PREPARED', scheduledArrival: booked }, live({ arrived: true } as Partial<TimingView>))
    expect(out).toContain('>Arrived<')
    expect(out).toContain('font-semibold')
    expect(out).toContain('confirmed by the railway')
  })

  it('shows a booked-only time faint and unlabelled, and says so on hover', () => {
    const out = html({ status: 'RECEIVED', scheduledArrival: booked }, null)
    expect(out).not.toContain('>ETA<')
    expect(out).toContain('text-faint')
    expect(out).toContain('no live reading yet')
  })

  it('shows a cancelled order faint, with no colour, whatever the cache says', () => {
    const out = html({ status: 'CANCELLED', scheduledArrival: booked }, live())
    expect(out).toContain('9:41 pm')
    expect(out).not.toContain('amber')
    expect(out).toContain('order closed')
  })

  it('shows a dash when there is no time at all', () => {
    expect(html({ status: 'RECEIVED', scheduledArrival: null }, null)).toContain('>-<')
  })
})
