import { describe, expect, it } from 'vitest'
import {
  formatIST, formatServiceDate, istLocalToUtc, paiseToRupees,
  rupeesToPaise, shiftServiceDate, utcToIstLocal,
} from '../src/lib/format'

describe('IST handling', () => {
  it('reads a datetime-local value as IST wall time, not UTC', () => {
    // The plan's sample order: "27-Aug 13:25" at Kanpur is 13:25 IST.
    const d = istLocalToUtc('2026-08-27T13:25')!
    expect(d.toISOString()).toBe('2026-08-27T07:55:00.000Z')
  })

  it('round-trips a timestamp through the form representation', () => {
    const iso = '2026-08-27T07:55:00.000Z'
    expect(utcToIstLocal(new Date(iso))).toBe('2026-08-27T13:25')
  })

  it('displays a UTC instant in IST', () => {
    // 18:45 UTC is 00:15 IST the NEXT day — the case that catches naive code.
    expect(formatIST(new Date('2026-08-27T18:45:00Z'))).toMatch(/28 Aug/)
  })

  it('keeps serviceDate on the intended day near midnight IST', () => {
    expect(formatServiceDate('2026-08-27')).toMatch(/Thu.*27 Aug.*2026/)
  })

  it('shifts service dates without drifting', () => {
    expect(shiftServiceDate('2026-08-27', 1)).toBe('2026-08-28')
    expect(shiftServiceDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftServiceDate('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('rejects malformed input rather than producing Invalid Date', () => {
    expect(istLocalToUtc('')).toBeNull()
    expect(istLocalToUtc('not-a-date')).toBeNull()
  })
})

describe('money', () => {
  it('converts rupees to integer paise', () => {
    expect(rupeesToPaise('236')).toBe(23600)
    expect(rupeesToPaise('236.50')).toBe(23650)
    expect(rupeesToPaise('1,250.75')).toBe(125075)
  })

  it('does not accumulate float error', () => {
    // 0.1 + 0.2 territory: 236.35 * 100 is 23634.999... in binary floating point.
    expect(rupeesToPaise('236.35')).toBe(23635)
    expect(Number.isInteger(rupeesToPaise('999.99'))).toBe(true)
  })

  it('round-trips', () => {
    expect(paiseToRupees(23600)).toBe('236.00')
    expect(rupeesToPaise(paiseToRupees(125075))).toBe(125075)
  })

  it('treats blank and negative as absent', () => {
    expect(rupeesToPaise('')).toBeNull()
    expect(rupeesToPaise(null)).toBeNull()
    expect(rupeesToPaise('-5')).toBeNull()
  })
})
