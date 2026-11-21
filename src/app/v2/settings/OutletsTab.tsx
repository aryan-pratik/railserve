import { Chip, Mono } from '@/components/v2/ui'
import { EmptyState, Pagination, Sub, Table, TableFrame, Td, Th, rowClass } from '@/components/v2/Table'
import { SettingsOutletDialog } from '@/components/v2/SettingsOutletDialog'
import { ActiveToggle, DeleteButton } from '@/components/v2/SettingsRowActions'
import { feedsByOutlet, orderCountsForOutlets, type OutletRow, type loadSetupBase } from '@/lib/v2/settings'
import { maskPhone } from '@/lib/riderRecords'
import { deleteOutlet, toggleOutletActive } from './actions'
import type { AuthContext } from '@/lib/authContext'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

export async function OutletsTab({
  ctx,
  base,
  kitchens,
  paging,
}: {
  ctx: AuthContext
  base: Base
  kitchens: OutletRow[]
  paging: { page: number; pageSize: number; skip: number }
}) {
  const pageRows = kitchens.slice(paging.skip, paging.skip + paging.pageSize)
  const orderCounts = await orderCountsForOutlets(ctx, pageRows.map((k) => k.id))
  const feeds = feedsByOutlet(base.listings, base.stations)
  const stationOptions = base.stations.map((s) => ({ code: s.code, name: s.name }))

  const buildHref = ({ page, pageSize }: { page: number; pageSize: number }) => {
    const u = new URLSearchParams({ tab: 'outlets' })
    if (page > 1) u.set('page', String(page))
    if (pageSize !== 20) u.set('pageSize', String(pageSize))
    return `/v2/settings?${u.toString()}`
  }

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-v2-muted">
          {kitchens.length} outlet{kitchens.length === 1 ? '' : 's'} · {kitchens.filter((k) => k.active).length} active. Deactivate anything that has been used; delete only works on a row nothing points at. Storefront names and routing live under Routing.
        </p>
        <SettingsOutletDialog stations={stationOptions} />
      </div>

      {kitchens.length === 0 ? (
        <EmptyState title="No outlets yet" note="An outlet is one of your kitchens at one station. Orders cannot be routed until there is one." action={<SettingsOutletDialog stations={stationOptions} />} />
      ) : (
        <TableFrame className="relative">
          <Table>
            <thead>
              <tr>
                <Th>Outlet</Th>
                <Th>Station</Th>
                <Th>Fed by</Th>
                <Th align="right">Walk</Th>
                <Th align="right">Orders</Th>
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => {
                const fed = feeds.get(o.id) ?? []
                const sources = [...new Set(fed.map((f) => f.source).filter(Boolean))] as string[]
                const unmapped = fed.filter((f) => f.viaDefault).length
                return (
                  <tr key={o.id} className={rowClass()}>
                    <Td className={o.active ? '' : 'text-v2-muted'}>
                      <span className="block max-w-[30ch] whitespace-normal">
                        <span className="font-semibold">{o.name}</span>
                        {o.contactName || o.contactPhone ? <Sub>{[o.contactName, o.contactPhone ? (maskPhone(o.contactPhone) ?? o.contactPhone) : null].filter(Boolean).join(' · ')}</Sub> : null}
                        {o.aliases.length ? <Sub>also {o.aliases.join(', ')}</Sub> : null}
                      </span>
                    </Td>
                    <Td>
                      <Mono className="font-semibold">{o.stationCode}</Mono>
                      {o.stationName ? <Sub>{o.stationName}</Sub> : null}
                    </Td>
                    <Td>
                      {fed.length === 0 ? (
                        <span className="text-v2-faint">Direct only</span>
                      ) : (
                        <>
                          <span className="flex flex-wrap gap-1">
                            {sources.map((s) => (
                              <Chip key={s} tone="grey">
                                {s}
                              </Chip>
                            ))}
                            {sources.length === 0 ? <Chip tone="grey">aggregator unknown</Chip> : null}
                          </span>
                          <Sub>
                            {fed.length} storefront{fed.length === 1 ? '' : 's'}
                            {unmapped ? ` · ${unmapped} via station default` : ''}
                          </Sub>
                        </>
                      )}
                    </Td>
                    <Td align="right">
                      <Mono>{o.walkToPlatformMinutes}</Mono> <span className="text-v2-muted">min</span>
                    </Td>
                    <Td align="right">
                      <Mono>{(orderCounts.get(o.id) ?? 0).toLocaleString('en-IN')}</Mono>
                    </Td>
                    <Td>
                      <ActiveToggle id={o.id} active={o.active} name={o.name} action={toggleOutletActive} />
                    </Td>
                    <Td align="right" className="whitespace-nowrap pl-0">
                      <span className="inline-flex items-center justify-end gap-0.5">
                        <SettingsOutletDialog
                          stations={stationOptions}
                          values={{
                            id: o.id,
                            name: o.name,
                            stationCode: o.stationCode,
                            stationName: o.stationName,
                            aliases: o.aliases,
                            contactName: o.contactName,
                            contactPhone: o.contactPhone,
                            walkToPlatformMinutes: o.walkToPlatformMinutes,
                          }}
                        />
                        <DeleteButton id={o.id} name={o.name} noun="outlet" action={deleteOutlet} />
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <Pagination page={paging.page} pageSize={paging.pageSize} total={kitchens.length} buildHref={buildHref} className="border-t border-v2-line" />
        </TableFrame>
      )}
    </div>
  )
}
