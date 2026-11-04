import Link from 'next/link'
import type { AuthContext } from '@/lib/authContext'
import { listReturns } from '@/lib/repo/rtoRepo'
import { getRtoCollectRoles } from '@/lib/repo/settingsRepo'
import { canCollectReturn, rtoReasonLabel, type RtoStatus } from '@/lib/rto'
import { ROLE_LABEL } from '@/lib/roles'
import { formatIST, formatMoney } from '@/lib/format'
import { readPage, withPage } from '@/lib/pagination'
import { Card, Dash, EmptyState, PageHeader, Pagination, StatusBadge, Tabs, thClass } from '@/components/ui'
import { MarkReturnedButton } from '@/components/ReturnToOrigin'

/**
 * Returns to origin, as a list: the bags still out with a rider, and the
 * ones already taken back. One screen shared by the store, the call desk and
 * the admin, each under its own path; the scope on the context decides what
 * each sees, and the admin's role grant decides who gets the button.
 */
export async function ReturnsScreen({
  ctx,
  basePath,
  orderBasePath,
  searchParams,
}: {
  ctx: AuthContext
  /** This section's returns page, e.g. `/store/returns`. */
  basePath: string
  /** Where a row's order id links, e.g. `/store/orders`. */
  orderBasePath: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const collected = searchParams.tab === 'collected'
  const status: RtoStatus = collected ? 'RETURNED' : 'PENDING'
  const { page, pageSize, skip } = readPage(searchParams)

  const [{ rows, total }, pendingTotal, allowed] = await Promise.all([
    listReturns(ctx, { status, limit: pageSize, skip }),
    collected ? listReturns(ctx, { status: 'PENDING', limit: 1, skip: 0 }).then((r) => r.total) : null,
    getRtoCollectRoles(),
  ])
  const pendingCount = pendingTotal ?? total
  const canCollect = canCollectReturn(ctx.role, allowed)
  const multiOutlet = ctx.role === 'ADMIN' || ctx.restaurantIds.length > 1

  const pageHref = (target: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
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
                ctx.role === 'TELECALLER' || ctx.role === 'STORE_MANAGER'
                  ? `${ROLE_LABEL[ctx.role]}s cannot mark a return here unless an admin allows it under Setup → Access.`
                  : ''
              }`.trim()
        }
      />

      <Tabs
        label="Returns"
        tabs={[
          { href: basePath, label: 'To collect', count: pendingCount, active: !collected },
          { href: `${basePath}?tab=collected`, label: 'Collected', active: collected },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={collected ? 'Nothing collected yet' : 'Nothing to collect'}
          note={
            collected
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
