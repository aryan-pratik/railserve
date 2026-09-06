import { findPayments, latestBalance, paymentTotals } from '@/lib/repo/paymentRepo'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { formatIST, formatMoney } from '@/lib/format'
import type { AuthContext } from '@/lib/authContext'
import { DateFilter } from './DateFilter'
import { IconDownload, IconSearch } from './Icons'
import { PaymentsLive } from './PaymentsLive'
import { PaymentsTable } from './PaymentsTable'
import { QueryForm } from './QueryForm'
import { ButtonAnchor, ButtonLink, EmptyState, PageHeader, Stat, StatStrip, inputClass } from './ui'

/** How many rows a single view will render before the filters have to narrow it. */
const ROW_LIMIT = 500

type SearchParams = Record<string, string | string[] | undefined>

/**
 * The payments page, for whichever console asked for it.
 *
 * One component rather than two near-identical pages: admin and store manager
 * are looking at the same shared bank account, so the only real differences
 * are the balance figure and the export button, both passed in.
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
  // A ledger opens on everything, not on today: the common reason to come
  // here is "did a payment from this person ever arrive".
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
    // Never even fetched for a store manager: the repository refuses the call.
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
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        note="Money received in the bank account, read from the credit alerts. Nothing here is an order; the remark is how a payment is tied to one."
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

      <StatStrip columns={balance ? 3 : 2}>
        {balance ? (
          <Stat
            label="Available balance"
            value={formatMoney(balance.balancePaise)}
            note={`as of ${formatIST(balance.asOf)}`}
            tone="text-accent"
          />
        ) : null}
        <Stat label="Received" value={formatMoney(totals.totalPaise)} note={ranged ? 'in this range' : 'all time'} />
        <Stat label="Payments" value={String(totals.count)} note={ranged ? 'in this range' : 'all time'} />
      </StatStrip>

      {/* Search and dates on one line. Both controls carry the other's state,
          so narrowing by one keeps the other. */}
      <QueryForm action={basePath} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Payer, RRN or remark"
            aria-label="Search payments by payer name, RRN or remark"
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} pl-9`}
          />
        </div>

        <DateFilter mode={mode} month={month} from={rawFrom} to={rawTo} allowAll autoSubmit />

        {hasFilters ? (
          <ButtonLink href={basePath} variant="ghost" size="sm">Clear filters</ButtonLink>
        ) : null}

        <span className="ml-auto shrink-0 text-xs tabular-nums text-faint">
          {payments.length === 1 ? '1 payment' : `${payments.length} payments`}
        </span>
      </QueryForm>

      {payments.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'Nothing matches these filters' : 'No payments yet'}
          note={
            hasFilters
              ? 'No payment in this date range carries that payer name, RRN or remark.'
              : 'Bank credit alerts arriving by email land here on their own, within a minute or two of the money.'
          }
          action={hasFilters ? <ButtonLink href={basePath}>Clear filters</ButtonLink> : undefined}
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
