import { findPayments, latestBalance, paymentTotals } from '@/lib/repo/paymentRepo'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { formatIST, formatMoney } from '@/lib/format'
import type { AuthContext } from '@/lib/authContext'
import { DateFilter } from './DateFilter'
import { IconDownload, IconSearch } from './Icons'
import { PaymentsLive } from './PaymentsLive'
import { PaymentsTable } from './PaymentsTable'
import { ButtonAnchor, Card, EmptyState, PageHeader } from './ui'

/** How many rows a single view will render before the filters have to narrow it. */
const ROW_LIMIT = 500

type SearchParams = Record<string, string | string[] | undefined>

/**
 * The payments page, for whichever console asked for it.
 *
 * One component rather than two near-identical pages: admin and store manager
 * are looking at the same shared bank account, so the only real differences
 * are the balance figure and the export button — both passed in, both absent
 * by default. A second copy of this would have drifted the first time a
 * column changed.
 *
 * Structure, top to bottom: what this page is, what the money adds up to, how
 * to narrow it, and then the rows. The filters sit in a single quiet strip
 * between the totals and the table rather than in a card of their own — they
 * are a tool for reading the table, not a third thing to read.
 */
export async function PaymentsScreen({
  ctx,
  basePath,
  /** The account balance and the CSV export are admin-only. */
  privileged = false,
  searchParams,
}: {
  ctx: AuthContext
  basePath: string
  privileged?: boolean
  searchParams: SearchParams
}) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  // A ledger opens on everything, not on today — the common reason to come
  // here is "did a payment from this person ever arrive", not "what landed in
  // the last few hours".
  const mode = (one(searchParams.mode) || 'all') as DateFilterMode
  const month = one(searchParams.month)
  const rawFrom = one(searchParams.from)
  const rawTo = one(searchParams.to)
  const q = one(searchParams.q).trim()
  const { from, to } = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })

  const query = { from, to, q }
  const [payments, totals, balance] = await Promise.all([
    findPayments(query, ROW_LIMIT),
    paymentTotals(query),
    // Never even fetched for a store manager — the repository refuses the
    // call, so the restriction does not depend on this component remembering
    // not to render the figure.
    privileged ? latestBalance(ctx) : Promise.resolve(null),
  ])

  const ranged = Boolean(from || to)
  const hasFilters = Boolean(ranged || q)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ mode, month, from: rawFrom, to: rawTo, q })) {
    if (v) params.set(k, v)
  }
  const exportHref = `${basePath}/export${params.toString() ? `?${params}` : ''}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        note="Money received in the bank account, read straight from the credit alerts. Nothing here is an order — tying a payment to one is what the remark is for."
        action={
          <>
            <PaymentsLive />
            {privileged ? (
              <ButtonAnchor href={exportHref} download>
                <IconDownload size={15} />
                Export CSV
              </ButtonAnchor>
            ) : null}
          </>
        }
      />

      {/*
        One instrument panel, not a row of free-floating cards. Divided
        columns keep the strip full-width whether it carries two figures or
        three, so its right edge lines up with the table below it — a
        three-column grid holding two tiles ends a third short and reads as
        a mistake.
      */}
      <Card
        className={`grid divide-y divide-line sm:divide-x sm:divide-y-0 ${
          balance ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
        }`}
      >
        {balance ? (
          <Stat
            label="Available balance"
            value={formatMoney(balance.balancePaise)}
            note={`as of ${formatIST(balance.asOf)}`}
            lead
          />
        ) : null}
        <Stat
          label="Received"
          value={formatMoney(totals.totalPaise)}
          note={ranged ? 'in this range' : 'all time'}
        />
        <Stat
          label="Payments"
          value={String(totals.count)}
          note={ranged ? 'in this range' : 'all time'}
        />
      </Card>

      {/*
        Search and dates on one line, baseline-aligned, no labels stacked
        above them: a label plus a hint turns a control into a three-line
        block and drags every button beside it out of line. Both controls
        carry the other's state, so narrowing by one keeps the other.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <form method="get" action={basePath} className="relative min-w-0 flex-1 sm:max-w-xs">
          <input type="hidden" name="mode" value={mode} />
          {month ? <input type="hidden" name="month" value={month} /> : null}
          {rawFrom ? <input type="hidden" name="from" value={rawFrom} /> : null}
          {rawTo ? <input type="hidden" name="to" value={rawTo} /> : null}
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search payer, RRN or remark"
            aria-label="Search payments by payer name, RRN or remark"
            className={
              'w-full rounded-lg border border-line-strong bg-surface py-2 pl-9 pr-3 text-sm ' +
              'text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent'
            }
          />
        </form>

        {/* Applies on click. A date pill that needs a second button pressed
            before it does anything looks broken the first time you use it. */}
        <DateFilter mode={mode} month={month} from={rawFrom} to={rawTo} allowAll autoSubmit />

        {hasFilters ? (
          <a
            href={basePath}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-sunken hover:text-ink"
          >
            Clear filters
          </a>
        ) : null}

        <span className="ml-auto shrink-0 text-xs tabular-nums text-faint">
          {payments.length === 1 ? '1 payment' : `${payments.length} payments`}
        </span>
      </div>

      {payments.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'Nothing matches these filters' : 'No payments yet'}
          note={
            hasFilters
              ? 'No payment in this date range carries that payer name, RRN or remark.'
              : 'Bank credit alerts arriving by email land here on their own, within a minute or two of the money.'
          }
        />
      ) : (
        <PaymentsTable
          payments={payments.map((p) => ({
            id: String(p._id),
            payerName: p.payerName,
            amountPaise: p.amountPaise,
            rrn: p.rrn,
            method: p.method,
            transactionDate: p.transactionDate,
            receivedAt: p.receivedAt.toISOString(),
            remark: p.remark,
          }))}
        />
      )}

      {payments.length === ROW_LIMIT ? (
        <p className="text-xs text-muted">
          Showing the {ROW_LIMIT} most recent payments. Narrow the dates to reach older ones.
        </p>
      ) : null}
    </div>
  )
}

/**
 * One figure in the panel.
 *
 * The balance leads in accent because it is the only present-tense number
 * here; the other two describe whatever range is selected, which is why each
 * says which period it means rather than leaving all three to be read as the
 * same one.
 */
function Stat({
  label,
  value,
  note,
  lead = false,
}: {
  label: string
  value: string
  note: string
  lead?: boolean
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div
        className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${
          lead ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-faint">{note}</div>
    </div>
  )
}
