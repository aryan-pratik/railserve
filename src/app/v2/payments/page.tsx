import { requirePage, requirePermission } from '@/lib/session'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { connectDb } from '@/lib/db'
import { findPayments, latestBalance, paymentTotals } from '@/lib/repo/paymentRepo'
import { findMany } from '@/lib/repo/orderRepo'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { formatDateRange, formatIST, formatMoney, formatRupees, formatShortDate, formatTimeIST } from '@/lib/format'
import { EmptyState, PageHeader, Pagination, Sub, Table, TableFrame, Td, Th, readPaging, rowClass } from '@/components/v2/Table'
import { Card, Chip, Mono, buttonClass, cx } from '@/components/v2/ui'
import { PaymentsFilterBar } from '@/components/v2/PaymentsFilterBar'
import { PaymentsLive } from '@/components/v2/PaymentsLive'
import { PaymentsRemark } from '@/components/v2/PaymentsRemark'
import { MoneyTabs } from '@/components/v2/MoneyTabs'

export const metadata = { title: 'Payments · RailServe' }

/**
 * The bank credit ledger, for every console. Payments are not outlet-scoped
 * (one shared account, and an alert names a payer and nothing else), so every
 * role sees the same rows; what differs is the balance and the export (admin)
 * and whether the remark can be edited (admin and store manager).
 */
export default async function V2PaymentsPage(props: PageProps<'/v2/payments'>) {
  const ctx = await requirePermission('payments.view')
  await requirePage('payments')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').trim()

  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  const month = one(sp.month)
  // Opens on today, like every dated screen. Typing a date is a custom range
  // whatever the mode said before.
  const mode = (rawFrom || rawTo ? 'range' : one(sp.mode) || 'today') as DateFilterMode
  const q = one(sp.q)
  const { page, pageSize, skip } = readPaging(sp)
  const { from, to } = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })
  const query = { from, to, q }

  const isAdmin = ctx.role === 'ADMIN'
  const canEdit = ctx.role !== 'TELECALLER'

  await connectDb()
  const [payments, totals, balance] = await Promise.all([
    findPayments(ctx, query, pageSize, skip),
    // Counts the whole range: the stat and the pager both read this, never
    // the page length.
    paymentTotals(ctx, query),
    isAdmin ? latestBalance(ctx) : Promise.resolve(null),
  ])

  // A remark that names an order id that exists becomes a link. Only the ids
  // on this page are looked up, within the person's own outlet scope.
  const tokens = [...new Set(payments.flatMap((p) => orderIdTokens(p.remark)))]
  const orders = tokens.length ? await findMany(ctx, { externalOrderId: { $in: tokens } }, { limit: tokens.length }) : []
  const orderByExternal = new Map(orders.map((o) => [o.externalOrderId, String(o._id)]))

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ mode: mode === 'today' ? '' : mode, month, from: rawFrom, to: rawTo, q })) if (v) params.set(k, v)
  const withPage = (t: { page: number; pageSize: number }) => {
    const u = new URLSearchParams(params)
    if (t.page > 1) u.set('page', String(t.page))
    if (t.pageSize !== 20) u.set('pageSize', String(t.pageSize))
    const s = u.toString()
    return s ? `/v2/payments?${s}` : '/v2/payments'
  }
  const exportParams = new URLSearchParams(params)
  if (mode !== 'today') exportParams.set('mode', mode)
  const exportHref = `/admin/payments/export${exportParams.toString() ? `?${exportParams}` : ''}`

  const ranged = Boolean(from || to)
  const periodLabel = !ranged ? 'all time' : from && to ? formatDateRange(from, to) : from ? `from ${formatShortDate(from)}` : `up to ${formatShortDate(to)}`
  const hasFilters = mode !== 'today' || Boolean(q)

  return (
    <div className="grid gap-[18px]">
      {isAdmin ? <MoneyTabs active="payments" /> : null}
      <PageHeader
        title={isAdmin ? 'Bank payments' : 'Payments'}
        note="Money that reached the bank account, read from the bank's alerts. Put the order number in a payment's remark to link the two."
        actions={
          <>
            <PaymentsLive />
            {isAdmin ? (
              <a href={exportHref} download className={buttonClass('secondary', 'md')}>
                <Download size={16} aria-hidden />
                Export CSV
              </a>
            ) : null}
          </>
        }
      />

      <div className={cx('grid grid-cols-1 gap-3.5 sm:grid-cols-2', balance ? 'xl:grid-cols-3' : '')}>
        <Stat label="Received" value={money(totals.totalPaise)} note={periodLabel} hero />
        <Stat label="Payments" value={totals.count.toLocaleString('en-IN')} note={periodLabel} />
        {balance ? (
          <Stat
            label="Bank balance"
            value={money(balance.balancePaise)}
            note={`after the last money came in, ${formatIST(balance.asOf)}. Spending since then is not shown.`}
          />
        ) : null}
      </div>

      <Card>
        <PaymentsFilterBar q={q} mode={mode} month={month} from={rawFrom} to={rawTo} hasFilters={hasFilters} />
      </Card>

      {payments.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'Nothing matches these filters' : 'No payments today'}
          note={hasFilters ? 'No payment in this date range carries that payer name, RRN or remark.' : 'Bank credit alerts arriving by email land here on their own, within a minute or two of the money.'}
          action={
            <Link href={hasFilters ? '/v2/payments' : '/v2/payments?mode=all'} className={buttonClass('secondary', 'sm')}>
              {hasFilters ? 'Clear filters' : 'Show all time'}
            </Link>
          }
        />
      ) : (
        <TableFrame>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Payer</Th>
                <Th align="right">Amount</Th>
                <Th>RRN</Th>
                <Th>Method</Th>
                <Th className="w-full">Remark</Th>
                <Th>Order</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const linked = orderIdTokens(p.remark)
                  .map((t) => ({ externalOrderId: t, id: orderByExternal.get(t) }))
                  .filter((x): x is { externalOrderId: string; id: string } => Boolean(x.id))
                return (
                  <tr key={String(p._id)} className={rowClass()}>
                    <Td>
                      <span title={p.transactionDate}>{formatShortDate(p.transactionDate)}</span>
                      {/* The alert prints a date and no time; the email's own
                          timestamp is when in the day the money landed. */}
                      <Sub>{formatTimeIST(p.receivedAt)}</Sub>
                    </Td>
                    <Td className="max-w-[16rem]">
                      <span className="block truncate font-semibold" title={p.payerName}>
                        {p.payerName}
                      </span>
                    </Td>
                    <Td align="right">
                      <Mono className="font-semibold">{money(p.amountPaise)}</Mono>
                    </Td>
                    <Td>
                      <Mono className="text-[12.5px] text-v2-ink-2">{p.rrn}</Mono>
                    </Td>
                    <Td>{p.method ? <Chip tone="grey">{p.method}</Chip> : <span className="text-v2-faint">—</span>}</Td>
                    <Td className="min-w-[14rem] whitespace-normal">
                      <PaymentsRemark paymentId={String(p._id)} remark={p.remark ?? null} canEdit={canEdit} />
                    </Td>
                    <Td>
                      {linked.length ? (
                        <span className="flex flex-wrap gap-1">
                          {linked.map((l) => (
                            <Link key={l.id} href={`/v2/orders/${l.id}`} className="rounded-full">
                              <Chip tone="ok">
                                <Mono>#{l.externalOrderId}</Mono>
                              </Chip>
                            </Link>
                          ))}
                        </span>
                      ) : (
                        <span className="text-v2-faint">—</span>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <div className="border-t border-v2-line">
            <Pagination page={page} pageSize={pageSize} total={totals.count} buildHref={withPage} />
          </div>
        </TableFrame>
      )}
    </div>
  )
}

/** Whole rupees as "₹1,940", like the rest of the app; paise only when there are some. */
function money(paise: number): string {
  return paise % 100 === 0 ? formatRupees(paise) : formatMoney(paise)
}

/**
 * Candidate order ids in a remark: runs of six or more digits, or a dashed
 * manual id such as MAN-20261121-3. Looked up as written and upper-cased.
 */
function orderIdTokens(remark: string | null | undefined): string[] {
  if (!remark) return []
  const found = remark.match(/[A-Za-z]{2,}-\d{6,}-\d+|\d{6,}/g) ?? []
  return [...new Set(found.flatMap((t) => [t, t.toUpperCase()]))]
}

function Stat({ label, value, note, hero }: { label: string; value: string; note: string; hero?: boolean }) {
  return (
    <div className={cx('grid gap-2 rounded-v2-lg border p-[18px]', hero ? 'border-v2-brand-deep bg-v2-brand-deep text-white' : 'border-v2-line bg-v2-surface')}>
      <span className="text-[15px] font-semibold">{label}</span>
      <span className="font-mono text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums">{value}</span>
      <span className={cx('text-[12.5px]', hero ? 'text-v2-mint' : 'text-v2-muted')}>{note}</span>
    </div>
  )
}
