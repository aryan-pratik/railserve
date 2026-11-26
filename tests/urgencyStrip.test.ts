import { describe, expect, it } from 'vitest'
import { stripStyle, urgencyFor } from '../src/lib/v2/urgency'
import { sortRunsByUrgency } from '../src/lib/runs'

const RED = 'bg-red-600 text-white'
const AMBER = 'bg-amber-500 text-[#0d1424]'
const GREEN = 'bg-emerald-700 text-white'
const NONE = 'bg-transparent text-v2-muted'

describe("the train countdown strip, as v1 drew it", () => {
  it('is green over 45 minutes out, amber from 45, red from 20', () => {
    expect(stripStyle(120)).toEqual({ fill: GREEN, big: '2h', small: '0m' })
    expect(stripStyle(46).fill).toBe(GREEN)
    expect(stripStyle(45)).toEqual({ fill: AMBER, big: '45', small: 'min' })
    expect(stripStyle(21).fill).toBe(AMBER)
    expect(stripStyle(20).fill).toBe(RED)
    expect(stripStyle(0)).toEqual({ fill: RED, big: 'now', small: 'due' })
  })

  it('stays amber for 20 minutes after arrival, then has no colour', () => {
    expect(stripStyle(-1)).toEqual({ fill: AMBER, big: '1m', small: 'ago' })
    expect(stripStyle(-20).fill).toBe(AMBER)
    expect(stripStyle(-99)).toEqual({ fill: NONE, big: '1h 39m', small: 'ago' })
    expect(stripStyle(-800).big).toBe('13h')
  })

  it('shows "? no eta" in grey with no arrival time, never the calm green', () => {
    expect(stripStyle(null)).toEqual({ fill: 'bg-[#c9cfda] text-[#0d1424]', big: '?', small: 'no eta' })
  })

  it('agrees with the countdown chips on the bands', () => {
    expect(urgencyFor(46)).toBe('calm')
    expect(urgencyFor(45)).toBe('soon')
    expect(urgencyFor(20)).toBe('urgent')
  })
})

describe('the order the trains are listed in, as v1', () => {
  it('puts trains still to come first, soonest first, so red sits above amber above green; then arrived ones, latest first; then unknown', () => {
    const now = Date.parse('2026-11-24T07:52:00+05:30')
    const at = (m: number | null) => (m === null ? null : new Date(now + m * 60_000))
    const trains = [
      { name: 'green, 47 min', eta: at(47) },
      { name: 'no time', eta: at(null) },
      { name: 'arrived 55 min ago', eta: at(-55) },
      { name: 'red, 11 min', eta: at(11) },
      { name: 'arrived 5 min ago', eta: at(-5) },
      { name: 'amber, 30 min', eta: at(30) },
    ]
    const order = sortRunsByUrgency(trains, (t) => t.eta, now).map((t) => t.name)
    expect(order).toEqual(['red, 11 min', 'amber, 30 min', 'green, 47 min', 'arrived 5 min ago', 'arrived 55 min ago', 'no time'])
  })
})
