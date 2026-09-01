import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { YatriRestroParser } from '../src/lib/ingest/parsers/yatriRestro'
import { YatriRestroBookingParser } from '../src/lib/ingest/parsers/yatriRestroBooking'
import * as pipeFx from './fixtures/yatriRestro'
import * as bookingFx from './fixtures/yatriRestroBooking'

/**
 * Both YatriRestro parsers share source YATRIRESTRO and are tried in order —
 * dispatch picks the FIRST one whose matches() returns true. A loose fallback
 * regex on one can silently steal emails meant for the other, which fails
 * differently than a wrong parse: the email lands in the unparsed inbox with
 * no hint that a different parser module was even in the running.
 */
describe('YatriRestro parser dispatch', () => {
  it('routes the pipe-delimited format to YatriRestroParser', () => {
    const parser = PARSERS.find((p) => p.matches(pipeFx.SAMPLE_WITH_EMOJI))
    expect(parser).toBeInstanceOf(YatriRestroParser)
  })

  it('routes the booking-confirmation table format to YatriRestroBookingParser', () => {
    const parser = PARSERS.find((p) => p.matches(bookingFx.SAMPLE))
    expect(parser).toBeInstanceOf(YatriRestroBookingParser)
  })

  it('still routes a Gmail-forwarded booking confirmation there, despite the vendor domain in its footer', () => {
    // "support@yatrirestro.com" contains "yatrirestro" as one unbroken word —
    // this is the exact case that used to false-match the pipe-delimited
    // parser's loose fallback and swallow the email before this one saw it.
    const parser = PARSERS.find((p) => p.matches(bookingFx.SAMPLE_FORWARDED))
    expect(parser).toBeInstanceOf(YatriRestroBookingParser)
  })
})
