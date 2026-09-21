import { describe, expect, it } from 'vitest'
import { arrivalBucket, isFiltered, readCallFilter, rowMatches, type CallFilter } from '../src/lib/callBoard'
import type { CallBoardRowData } from '../src/lib/orderView'

const row = (over: Partial<CallBoardRowData> = {}): CallBoardRowData => ({
  id: '1', externalOrderId: 'MAN-001', orderType: 'RETAIL', status: 'RECEIVED',
  coach: 'B2', berth: '14', rawSeat: null, handoverPoint: null,
  contactName: 'Asha Verma', contactPhone: '9876500001', itemCount: 1, itemSummary: 'Veg Thali',
  paymentMode: 'COD', outletName: null, canCancel: true, callNoteCount: 0, callNoteHint: null, lastCall: null,
  ...over,
})
const run = { trainNo: '12398', trainName: 'MAHABODHI EXP' }
const none: CallFilter = { q: '', call: 'all', status: 'all', outlet: '' }

describe('readCallFilter', () => {
  it('defaults to no filter and ignores unknown values', () => {
    expect(readCallFilter({})).toEqual(none)
    expect(readCallFilter({ call: 'bogus', status: 'nope' })).toEqual(none)
    expect(isFiltered(none)).toBe(false)
  })
  it('reads each filter and trims the search', () => {
    const f = readCallFilter({ q: '  asha ', call: 'todo', status: 'ready', outlet: 'abc' })
    expect(f).toEqual({ q: 'asha', call: 'todo', status: 'ready', outlet: 'abc' })
    expect(isFiltered(f)).toBe(true)
  })
})

describe('rowMatches', () => {
  it('splits called from not called', () => {
    const called = row({ lastCall: { text: 'ok', by: 'S', atLabel: '1:00 am' } })
    expect(rowMatches(row(), run, { ...none, call: 'todo' })).toBe(true)
    expect(rowMatches(called, run, { ...none, call: 'todo' })).toBe(false)
    expect(rowMatches(called, run, { ...none, call: 'done' })).toBe(true)
    expect(rowMatches(row(), run, { ...none, call: 'done' })).toBe(false)
  })
  it('groups statuses', () => {
    expect(rowMatches(row({ status: 'KOT_PRINTED' }), run, { ...none, status: 'preparing' })).toBe(true)
    expect(rowMatches(row({ status: 'PREPARED' }), run, { ...none, status: 'preparing' })).toBe(false)
    expect(rowMatches(row({ status: 'DISPATCHED' }), run, { ...none, status: 'platform' })).toBe(true)
  })
  it('searches name, phone, order id and seat, case-insensitively', () => {
    for (const q of ['asha', 'VERMA', '98765', 'man-001', 'b2', '14']) {
      expect(rowMatches(row(), run, { ...none, q })).toBe(true)
    }
    expect(rowMatches(row(), run, { ...none, q: 'zzz' })).toBe(false)
  })
  it('keeps every passenger when the search names the train', () => {
    expect(rowMatches(row({ contactName: 'Someone Else' }), run, { ...none, q: '12398' })).toBe(true)
    expect(rowMatches(row(), run, { ...none, q: 'mahabodhi' })).toBe(true)
  })
})

describe('arrivalBucket', () => {
  const now = new Date('2026-09-22T10:00:00Z')
  const at = (m: number) => new Date(now.getTime() + m * 60_000)
  it('sections trains by how soon they arrive', () => {
    expect(arrivalBucket(at(30), now)).toBe('hour')
    expect(arrivalBucket(at(60), now)).toBe('hour')
    expect(arrivalBucket(at(61), now)).toBe('soon')
    expect(arrivalBucket(at(180), now)).toBe('soon')
    expect(arrivalBucket(at(181), now)).toBe('later')
    expect(arrivalBucket(at(-5), now)).toBe('arrived')
    expect(arrivalBucket(null, now)).toBe('unknown')
  })
})

import { SOON_MINUTES, URGENT_MINUTES, urgencyBand } from '../src/lib/urgency'

describe('urgencyBand', () => {
  it('turns red, amber, green at the shared thresholds', () => {
    expect(urgencyBand(URGENT_MINUTES)).toBe('red')
    expect(urgencyBand(URGENT_MINUTES + 1)).toBe('amber')
    expect(urgencyBand(SOON_MINUTES)).toBe('amber')
    expect(urgencyBand(SOON_MINUTES + 1)).toBe('green')
  })
  it('has no colour for an unknown or already-passed arrival', () => {
    expect(urgencyBand(null)).toBe('none')
    expect(urgencyBand(0)).toBe('none')
    expect(urgencyBand(-30)).toBe('none')
  })
})
