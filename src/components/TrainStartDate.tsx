import { todayIST } from '@/lib/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The day this run left its origin, beside the train number.
 *
 * A train due here at 00:30 on the 17th may have started on the 15th, and the
 * same number runs every day; the start date is what tells one run from the
 * next, and what the railway's own enquiry asks for. Renders nothing until the
 * train feed has reported it, and nothing for a train that started today:
 * only a run already on its way since an earlier day needs telling apart.
 */
export function TrainStartDate({ date }: { date?: string | null }) {
  // Read straight off the 'YYYY-MM-DD' string: it is a calendar date, and
  // going through Date would shift it a day in any timezone west of UTC.
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  // ISO dates compare correctly as strings.
  if (!m || !month || date! >= todayIST()) return null
  return (
    <span
      className="self-center whitespace-nowrap rounded-md bg-sunken px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted ring-1 ring-inset ring-line"
      title="Date the train started from its origin station"
    >
      Started {Number(m[3])} {month}
    </span>
  )
}
