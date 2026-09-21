import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDateRange } from '../src/lib/dateFilter'

/**
 * "Yesterday" is the IST calendar day before today, whatever UTC thinks.
 *
 * The easy mistake is now-minus-24h, which is wrong in the first hours after
 * midnight IST: UTC is still on the previous date, so it returns two days ago.
 * That is exactly when a kitchen reconciles last night's orders.
 */
describe('resolveDateRange: yesterday', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is the previous IST day just after midnight IST', () => {
    vi.useFakeTimers()
    // 00:30 IST on 22 Sep = 19:00 UTC on 21 Sep.
    vi.setSystemTime(new Date('2026-09-21T19:00:00Z'))
    expect(resolveDateRange('yesterday', {})).toEqual({
      from: '2026-09-21',
      to: '2026-09-21',
      month: '2026-09',
    })
  })

  it('crosses a month boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T06:00:00Z')) // 11:30 IST, 1 Oct
    expect(resolveDateRange('yesterday', {})).toEqual({
      from: '2026-09-30',
      to: '2026-09-30',
      month: '2026-09',
    })
  })

  it('leaves today untouched', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T19:00:00Z'))
    expect(resolveDateRange('today', {}).from).toBe('2026-09-22')
  })
})
