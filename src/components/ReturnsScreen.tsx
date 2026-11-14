import Link from 'next/link'
import type { AuthContext } from '@/lib/authContext'
import { listReturns, mayCollectReturns } from '@/lib/repo/rtoRepo'
import { rtoReasonLabel, type RtoStatus } from '@/lib/rto'
import { formatIST, formatMoney } from '@/lib/format'
import { readPage, withPage } from '@/lib/pagination'
import { connectDb } from '@/lib/db'
import { Card, Dash, EmptyState, PageHeader, Pagination, StatusBadge, Tabs, thClass } from '@/components/ui'
import { MarkReturnedButton } from '@/components/ReturnToOrigin'
import { OrderFilterBar } from '@/components/OrderFilterBar'
import {
  hasOrderFilters, orderFilterClause, orderFilterOptions, orderFilterParams, readOrderFilters,
} from '@/lib/repo/orderFilters'

/**
 * Returns to origin, as a list: the bags still out with a rider, and the
 * ones already taken back. One screen shared by the store, the call desk and
 * the admin, each under its own path; the scope on the context decides what
 * each sees, and the tick on the manager's staff record decides who gets
 * the button.
 */
export async function ReturnsScreen({
  ctx,
  basePath,
  orderBasePath,
  searchParams,
  defaultMode = 'all',
}: {
  ctx: AuthContext
  /** This section's returns page, e.g. `/store/returns`. */
  basePath: string
  /** Where a row's order id links, e.g. `/store/orders`. */
  orderBasePath: string
  searchParams: Record<string, string | string[] | undefined>
  /** The dates the filter bar opens on. */
  defaultMode?: 'all' | 'today'
}) {
  const collected = searchParams.tab === 'collected'
  const status: RtoStatus = collected ? 'RETURNED' : 'PENDING'
  const { page, pageSize, skip } = readPage(searchParams)

  // The same filter bar as All orders. Which dates it opens on is the screen's
  // call: the admin's opens on today, like All orders, with an earlier day one
  // "All time" away (and a search widens it by itself). A store's opens on all
  // time, because a bag still out from yesterday must not drop off its list.
  const filters = readOrderFilters(searchParams, { defaultMode })
  const filtered = hasOrderFilters(filters)
  await connectDb()
  const where = await orderFilterClause(filters)

  const [{ rows, total }, pendingTotal, canCollect, options] = await Promise.all([
    listReturns(ctx, { status, limit: pageSize, skip, where }),
    collected ? listReturns(ctx, { status: 'PENDING', limit: 1, skip: 0, where }).then((r) => r.total) : null,
    mayCollectReturns(ctx),
    orderFilterOptions(ctx, filters.stations),
  ])
  const pendingCount = pendingTotal ?? total
  const multiOutlet = ctx.role === 'ADMIN' || ctx.restaurantIds.length > 1

  // Tabs and the pager carry the filters in play.
  const tabHref = (tab: string) => {
    const u = orderFilterParams(filters)
    if (tab) u.set('tab', tab)
    const qs = u.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  const pageHref = (target: { page: number; pageSize: number }) => {
    const u = orderFilterParams(filters)
    if (collected) u.set('tab', 'collected')
    const qs = withPage(u, target).toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Returns"
        note={
          canCollect
            ? 'Orders cancelled or not delivered after a rider took them. The bag comes back to the outlet it left; mark it returned once it is on the counter.'
            : `Orders cancelled or not delivered after a rider took them. The bag comes back to the outlet it left. ${
                ctx.role === 'STORE_MANAGER'
                  ? 'You are not set up to mark returns: an admin can allow it on your staff record.'
                  : 'The store manager at that outlet marks it returned.'
              }`
        }
      />

      <Tabs
        label="Returns"
        tabs={[
          { href: tabHref(''), label: 'To collect', count: pendingCount, active: !collected },
          { href: tabHref('collected'), label: 'Collected', active: collected },
        ]}
      />

      <Card className="p-3">
        {/* The tabs own this value; without it, filtering would drop it. */}
        <OrderFilterBar
          action={basePath}
          filters={filters}
          options={options}
          hidden={{ tab: collected ? 'collected' : '' }}
        />
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title={
            filtered ? 'Nothing matches these filters' : collected ? 'Nothing collected yet' : 'Nothing to collect'
          }
          note={
            filtered
              ? 'Try clearing them, or widen the dates.'
              : collected
              ? 'Returns marked as back at the counter will be listed here.'
              : 'When a rider cannot deliver an order, or it is cancelled on the way, it shows up here until the outlet takes the bag back.'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-sunken/60">
              <tr>
                <th className={thClass}>Order</th>
                <th className={`${thClass} hidden sm:table-cell`}>Why</th>
                <th className={thClass}>Rider</th>
                {multiOutlet ? <th className={`${thClass} hidden md:table-cell`}>Outlet</th> : null}
                <th className={`${thClass} hidden lg:table-cell`}>{collected ? 'Returned' : 'Out since'}</th>
                <th className={`${thClass} w-px`}>
                  <span className="sr-only">{collected ? 'Taken back by' : 'Actions'}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`${orderBasePath}/${r.id}`}
                        className="font-mono font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        {r.externalOrderId}
                      </Link>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {r.trainNo ? <span className="font-mono tabular-nums">{r.trainNo}</span> : null}
                      {r.trainNo && r.rawSeat ? ' · ' : ''}
                      {r.rawSeat ? <span className="font-mono">{r.rawSeat}</span> : null}
                      {r.trainNo || r.rawSeat ? ' · ' : ''}
                      {r.contactName ? `${r.contactName} · ` : ''}
                      {r.itemCount} item{r.itemCount === 1 ? '' : 's'}
                      {r.codPaise !== null ? ` · COD ${formatMoney(r.codPaise)} not collected` : ''}
                    </div>
                    <div className="text-xs text-muted sm:hidden">{rtoReasonLabel(r.reason)}</div>
                    {r.note ? <div className="mt-1 text-xs text-ink">&ldquo;{r.note}&rdquo;</div> : null}
                  </td>
                  <td className="hidden px-3 py-2.5 align-top text-muted sm:table-cell">{rtoReasonLabel(r.reason)}</td>
                  <td className="px-3 py-2.5 align-top text-ink">
                    {r.riders.length > 0 ? r.riders.join(', ') : <Dash />}
                  </td>
                  {multiOutlet ? (
                    <td className="hidden px-3 py-2.5 align-top text-muted md:table-cell">{r.outletName ?? <Dash />}</td>
                  ) : null}
                  <td className="hidden px-3 py-2.5 align-top whitespace-nowrap text-xs tabular-nums text-muted lg:table-cell">
                    {formatIST(collected ? r.returnedAt : r.openedAt)}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {collected ? (
                      <span className="text-xs text-muted">{r.returnedBy ?? <Dash />}</span>
                    ) : canCollect ? (
                      <MarkReturnedButton orderId={r.id} externalOrderId={r.externalOrderId} compact />
                    ) : (
                      <span className="text-xs text-faint">Waiting</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={pageSize} total={total} buildHref={pageHref} />
        </Card>
      )}
    </div>
  )
}
