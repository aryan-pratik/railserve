import { describe, expect, it } from 'vitest'
import { parseBulkEnquiry, parseEnquiryDate, parseEnquiryTime } from '../src/lib/ingest/parsers/bulkEnquiry'

const NOW = new Date('2026-08-27T08:00:00Z')

/** The exact sample from plan §7. */
const SAMPLE = `*Query*
Date =03-Sep
Location =Kanpur Central
Train no -
Time  = 7:30PM
Pax = 75
Menu = 2pcs Egg Curry + Dry aloo jeera + Dal Fry + Jeera Rice + 3 Butter Roti + Sweet ( Gulab Jamun )  + Salad + Pickel + Tissue + Spoon, water bottle 500ml.`

describe('bulk enquiry parser', () => {
  it('parses the plan §7 sample', () => {
    const r = parseBulkEnquiry(SAMPLE, NOW)
    expect(r.serviceDate).toBe('2026-09-03')
    expect(r.location).toBe('Kanpur Central')
    expect(r.time).toBe('19:30')
    expect(r.pax).toBe(75)
    expect(r.menu).toContain('Egg Curry')
    // The menu stays one block — nobody types a 12-component thali into 12 rows.
    expect(r.menu).toContain('water bottle 500ml')
    expect(r.trainNo).toBeNull()
  })

  it('never drops an unrecognised line', () => {
    const r = parseBulkEnquiry(`${SAMPLE}\nAdvance = 5000 paid by UPI\nPlease confirm by evening`, NOW)
    expect(r.notes.join(' ')).toContain('5000')
    expect(r.notes.join(' ')).toContain('confirm by evening')
  })

  it('treats a blank field as blank, not as a note', () => {
    // "Train no -" with nothing after it is the sender leaving it empty.
    const r = parseBulkEnquiry(SAMPLE, NOW)
    expect(r.notes.some((n) => /train/i.test(n))).toBe(false)
  })

  it('keeps a menu that contains hyphens and equals signs intact', () => {
    const r = parseBulkEnquiry('Menu = Thali - veg = 2 rotis + dal', NOW)
    expect(r.menu).toBe('Thali - veg = 2 rotis + dal')
  })

  it('accepts the alias spellings from the plan', () => {
    const r = parseBulkEnquiry('Station = Prayagraj\nNo of pax = 40\nTrain number = 12506', NOW)
    expect(r.location).toBe('Prayagraj')
    expect(r.pax).toBe(40)
    expect(r.trainNo).toBe('12506')
  })
})

describe('enquiry dates and times', () => {
  it('reads day-month with no year as the coming occurrence', () => {
    expect(parseEnquiryDate('03-Sep', NOW)).toBe('2026-09-03')
    expect(parseEnquiryDate('3 Sep', NOW)).toBe('2026-09-03')
  })

  it('rolls a long-past date into next year', () => {
    // An enquiry is for upcoming service, so 2 Jan seen in August means next year.
    expect(parseEnquiryDate('02-Jan', NOW)).toBe('2027-01-02')
  })

  it('accepts numeric and ISO forms', () => {
    expect(parseEnquiryDate('03/09', NOW)).toBe('2026-09-03')
    expect(parseEnquiryDate('2026-09-03', NOW)).toBe('2026-09-03')
  })

  it('returns null on nonsense rather than a wrong date', () => {
    expect(parseEnquiryDate('next tuesday', NOW)).toBeNull()
    expect(parseEnquiryDate('45-Xyz', NOW)).toBeNull()
  })

  it('normalises times', () => {
    expect(parseEnquiryTime('7:30PM')).toBe('19:30')
    expect(parseEnquiryTime('19:30')).toBe('19:30')
    expect(parseEnquiryTime('7.30 pm')).toBe('19:30')
    expect(parseEnquiryTime('12:15 am')).toBe('00:15')
    expect(parseEnquiryTime('9 AM')).toBe('09:00')
  })
})
