import { Card, Chip, Mono } from '@/components/v2/ui'
import { EmptyState } from '@/components/v2/Table'
import { ListingRoute, SenderAllowlist, StationKitchenSelect } from '@/components/v2/SettingsRouting'
import { ActiveToggle } from '@/components/v2/SettingsRowActions'
import { loadAllowedSenders, orderCountsForListings, type loadSetupBase } from '@/lib/v2/settings'
import { setListingActive } from './actions'
import type { AuthContext } from '@/lib/authContext'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

/**
 * v1 "Aggregators": which mail is read, and which kitchen cooks for each
 * storefront name. One card per station, the fallback underneath its
 * storefronts, because a fallback only makes sense once you can see what it
 * is a fallback for.
 */
export async function RoutingTab({ ctx, base }: { ctx: AuthContext; base: Base }) {
  const [senders, listingCounts] = await Promise.all([loadAllowedSenders(ctx), orderCountsForListings(ctx, base.listings)])
  const outletById = new Map(base.outlets.map((o) => [o.id, o]))
  const codes = [...new Set(base.listings.map((l) => l.stationCode))].sort()

  return (
    <div className="grid gap-3.5">
      <Card title="Order mail senders" action={<Chip tone={senders.length ? 'ok' : 'warn'}>{senders.length ? `${senders.length} listed` : 'All senders'}</Chip>}>
        <SenderAllowlist senders={senders} />
      </Card>

      {codes.length === 0 ? (
        <EmptyState title="No storefronts recorded yet" note="A storefront is the name a kitchen trades under on an aggregator. They appear here as orders arrive." />
      ) : null}

      {codes.map((code) => {
        const here = base.listings.filter((l) => l.stationCode === code)
        const kitchens = base.outlets.filter((o) => o.active && o.stationCode === code).map((o) => ({ id: o.id, name: o.name }))
        const station = base.stations.find((s) => s.code === code)
        const defaultId = station?.defaultRestaurantId ?? null
        const defaultName = defaultId ? (outletById.get(defaultId)?.name ?? null) : null

        return (
          <Card key={code} className="gap-0 overflow-hidden p-0">
            <header className="flex items-baseline gap-2 px-[18px] pt-[18px] pb-3">
              <h3 className="font-mono text-[17px] font-bold tracking-[-0.01em]">{code}</h3>
              <span className="text-[13px] font-medium text-v2-muted">
                {station?.name ? `${station.name} · ` : ''}
                {here.length} storefront{here.length === 1 ? '' : 's'} · {kitchens.length} kitchen{kitchens.length === 1 ? '' : 's'}
              </span>
            </header>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-v2-line bg-v2-surface-2 px-[18px] py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-v2-muted md:grid-cols-[minmax(0,1.1fr)_5rem_minmax(0,1.6fr)_auto]">
              <span>Storefront name in the mail</span>
              <span className="hidden md:block">Orders</span>
              <span className="hidden md:block">Cooked by</span>
              <span>Status</span>
            </div>
            {here.map((l) => (
              <div
                key={l.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-b border-v2-line px-[18px] py-3 md:grid-cols-[minmax(0,1.1fr)_5rem_minmax(0,1.6fr)_auto] md:items-center"
              >
                <div className={l.active ? '' : 'text-v2-muted'}>
                  <div className="font-semibold [overflow-wrap:anywhere]">{l.name}</div>
                  <div className="text-xs text-v2-muted">
                    {l.source ? <Mono>{l.source}</Mono> : <span className="italic">aggregator unknown</span>}
                    {l.aliases.length ? <span> · also {l.aliases.join(', ')}</span> : null}
                    <span className="md:hidden"> · {listingCounts.get(l.id) ?? 0} orders</span>
                  </div>
                </div>
                <div className="hidden font-mono text-sm tabular-nums text-v2-muted md:block">{(listingCounts.get(l.id) ?? 0).toLocaleString('en-IN')}</div>
                <div className="col-span-2 md:col-span-1">
                  <ListingRoute
                    listing={{ id: l.id, name: l.name, source: l.source, restaurantId: l.restaurantId, orderCount: listingCounts.get(l.id) ?? 0 }}
                    outlets={kitchens}
                    stationDefaultName={defaultName}
                  />
                </div>
                <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
                  <ActiveToggle id={l.id} active={l.active} name={l.name} action={setListingActive} />
                </div>
              </div>
            ))}
            <div className="bg-v2-surface-2 px-[18px] py-3">
              <StationKitchenSelect stationCode={code} current={defaultId} outlets={kitchens} />
            </div>
          </Card>
        )
      })}
    </div>
  )
}
