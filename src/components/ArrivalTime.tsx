import { formatTimeIST } from '@/lib/format'
import type { ArrivalRecord } from '@/lib/arrival'

/**
 * One arrival for a record row. It only draws; arrivalRecord decides.
 *
 * Three visual channels, each carrying exactly one meaning, so a row can be
 * read without a legend:
 *
 *   word    what the time IS       ETA, Arrived, Delivered, or none for
 *                                  a booked time. Whole words: "exp" read
 *                                  as easily as "expired" as "expected".
 *   weight  how SURE it is         bold for a fact, regular for an
 *                                  estimate, faint for booked-only
 *   hue     how far it MOVED       amber later than booked, blue earlier,
 *                                  none within five minutes
 *
 * Everything else, the booked time, the size of the move and how old the
 * reading is, lives in the tooltip. The full live reading belongs on the
 * order's own page and on the live board, not in a record scanned forty rows
 * at a time.
 */
export function ArrivalTime({ record }: { record: ArrivalRecord }) {
  if (!record.time) return <span className="text-faint">-</span>

  const word =
    record.kind === 'expected'
      ? 'ETA'
      : record.kind === 'arrived'
        ? 'Arrived'
        : record.kind === 'delivered'
          ? 'Delivered'
          : null

  const weight =
    record.certainty === 'fact'
      ? 'font-semibold'
      : record.certainty === 'estimate'
        ? 'font-normal'
        : 'font-normal text-faint'

  const hue =
    record.direction === 'later'
      ? 'text-amber-700'
      : record.direction === 'earlier'
        ? 'text-sky-700'
        : record.certainty === 'fact' || record.certainty === 'estimate'
          ? 'text-ink'
          : ''

  const detail = [
    record.kind === 'delivered' ? `Delivered ${formatTimeIST(record.time)}` : null,
    record.kind === 'expected' ? `Expected ${formatTimeIST(record.time)}` : null,
    record.kind === 'arrived' ? `Train arrived ${formatTimeIST(record.time)}, confirmed by the railway` : null,
    record.pastDue ? 'past due, waiting for the railway to confirm' : null,
    record.booked ? `booked ${formatTimeIST(record.booked)}` : null,
    record.direction && record.minutesVsBooked !== null
      ? `${shift(record.minutesVsBooked)} ${record.direction} than booked`
      : null,
    record.certainty === 'unverified' ? 'no live reading yet' : null,
    record.certainty === 'context' ? 'order closed' : null,
    record.checkedMinutesAgo !== null && record.kind === 'expected'
      ? `checked ${record.checkedMinutesAgo}m ago`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span title={detail} className="inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums">
      {word ? <span className="text-[11px] text-faint">{word}</span> : null}
      <span className={`${weight} ${hue}`}>{formatTimeIST(record.time)}</span>
      <span className="sr-only">. {detail}</span>
    </span>
  )
}

function shift(minutes: number): string {
  const m = Math.abs(minutes)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
