import { Card, Chip, Mono } from '@/components/v2/ui'
import { EmptyState, KeyValue } from '@/components/v2/Table'
import { StationKitchenSelect } from '@/components/v2/SettingsRouting'
import { agentPresence, relativeAgo, type OutletRow, type loadSetupBase } from '@/lib/v2/settings'
import { formatIST } from '@/lib/format'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

/**
 * One card per station we serve. Read only except the default kitchen: the
 * print token and direct printer are issued by scripts today and become
 * editable per tenant in the next phase.
 */
export function StationsTab({ base, kitchens, now }: { base: Base; kitchens: OutletRow[]; now: Date }) {
  if (base.stations.length === 0) {
    return <EmptyState title="No stations yet" note="A station appears here as soon as an outlet names it. Create your first outlet under Outlets." />
  }
  const nowMs = now.getTime()

  return (
    <div className="grid gap-3.5 md:grid-cols-2 2xl:grid-cols-3">
      {base.stations.map((s) => {
        const here = kitchens.filter((k) => k.stationCode === s.code)
        const activeHere = here.filter((k) => k.active)
        const storefronts = base.listings.filter((l) => l.active && l.stationCode === s.code)
        const unmapped = storefronts.filter((l) => !l.restaurantId).length
        const agent = agentPresence(s.agentLastSeenIso, nowMs)
        const printing = s.directPrinterHost
          ? { tone: 'ok' as const, label: 'Direct printer' }
          : !s.hasAgentToken
            ? { tone: 'grey' as const, label: 'No print agent' }
            : agent.online
              ? { tone: 'ok' as const, label: 'Agent online' }
              : { tone: 'warn' as const, label: 'Agent offline' }

        return (
          <Card
            key={s.code}
            title={
              <span className="flex items-baseline gap-2">
                <Mono>{s.code}</Mono>
                <span className="truncate text-[15px] font-semibold text-v2-ink-2">{s.name ?? 'Unnamed station'}</span>
              </span>
            }
            action={<Chip tone={printing.tone}>{printing.label}</Chip>}
          >
            <KeyValue
              rows={[
                {
                  label: 'Kitchens',
                  value: activeHere.length ? activeHere.map((k) => k.name).join(', ') : <span className="text-v2-muted">none active</span>,
                },
                {
                  label: 'Storefronts',
                  value: storefronts.length ? `${storefronts.length}${unmapped ? ` · ${unmapped} unmapped` : ''}` : <span className="text-v2-muted">none recorded</span>,
                },
                {
                  label: 'Print agent',
                  value: s.hasAgentToken ? (
                    <span>
                      Token issued · {agent.label}
                      {s.agentLastPrintedIso ? <span className="block text-xs text-v2-muted">last printed {formatIST(s.agentLastPrintedIso)} ({relativeAgo(nowMs - new Date(s.agentLastPrintedIso).getTime())})</span> : null}
                    </span>
                  ) : (
                    <span className="text-v2-muted">no token issued</span>
                  ),
                },
                {
                  label: 'Direct printer',
                  value: s.directPrinterHost ? (
                    <Mono>
                      {s.directPrinterHost}:{s.directPrinterPort}
                    </Mono>
                  ) : (
                    <span className="text-v2-muted">not set · prints via the agent</span>
                  ),
                },
                ...(s.configured && !s.active ? [{ label: 'Station', value: <Chip tone="bad">Deactivated</Chip> }] : []),
              ]}
            />
            <div className="grid gap-1.5 border-t border-v2-line pt-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-v2-muted">Default kitchen</span>
              <StationKitchenSelect compact stationCode={s.code} current={s.defaultRestaurantId} outlets={activeHere.map((k) => ({ id: k.id, name: k.name }))} />
              <p className="text-xs text-v2-muted">Where a storefront name nobody has mapped goes. Without one, those orders wait in the Inbox.</p>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
