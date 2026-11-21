import { Card, Chip, Mono } from '@/components/v2/ui'
import { KeyValue, Notice } from '@/components/v2/Table'
import { loadIntegrations, type OutletRow, type loadSetupBase } from '@/lib/v2/settings'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

/**
 * Groundwork for tenancy: the facts about this company in one place, read
 * only. No model behind it yet; the name is a placeholder and the rest is
 * derived from outlets, staff and the environment.
 */
export async function CompanyTab({ base, kitchens, staffCount }: { base: Base; kitchens: OutletRow[]; staffCount: number; now: Date }) {
  const integrations = await loadIntegrations()
  const activeKitchens = kitchens.filter((k) => k.active)
  const sources = [...new Set(base.listings.filter((l) => l.active && l.source).map((l) => l.source as string))].sort()

  const ingestion = !integrations.gmail.configured
    ? 'Not connected'
    : integrations.gmail.address
      ? `Orders arrive at ${integrations.gmail.address}`
      : 'Connected (mailbox address not named in the environment)'

  return (
    <div className="grid gap-3.5">
      <div className="grid gap-3.5 xl:grid-cols-[1.2fr_1fr]">
        <Card title="Company" action={<Chip tone="grey">Placeholder</Chip>}>
          <KeyValue
            rows={[
              { label: 'Name', value: <span className="font-semibold">RailServe</span> },
              {
                label: 'Stations served',
                value: (
                  <span className="flex flex-wrap gap-1.5">
                    {base.stations.map((s) => (
                      <Chip key={s.code} tone="grey">
                        <Mono>{s.code}</Mono>
                        {s.name ? <span className="font-normal text-v2-muted">{s.name}</span> : null}
                      </Chip>
                    ))}
                    {base.stations.length === 0 ? <span className="text-v2-muted">none yet</span> : null}
                  </span>
                ),
              },
              {
                label: 'Outlets',
                value: `${activeKitchens.length} active kitchen${activeKitchens.length === 1 ? '' : 's'}${kitchens.length > activeKitchens.length ? ` · ${kitchens.length - activeKitchens.length} inactive` : ''}`,
              },
              { label: 'Staff', value: `${staffCount} active account${staffCount === 1 ? '' : 's'}` },
              { label: 'Aggregators', value: sources.length ? sources.join(', ') : 'none recorded yet' },
              { label: 'Timezone', value: 'Asia/Kolkata (IST)' },
            ]}
          />
        </Card>

        <Card title="Connected to">
          <KeyValue
            rows={[
              {
                label: 'Order mail',
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{ingestion}</span>
                    <Chip tone={integrations.gmail.configured ? (integrations.gmail.stale ? 'bad' : 'ok') : 'grey'}>
                      {integrations.gmail.configured ? (integrations.gmail.stale ? 'Stalled' : 'Gmail') : 'Off'}
                    </Chip>
                  </span>
                ),
              },
              {
                label: 'WhatsApp',
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{integrations.whatsapp.simulated ? 'Simulator (no real messages are sent)' : `MSG91${integrations.whatsapp.numberMasked ? ` · ${integrations.whatsapp.numberMasked}` : ''}`}</span>
                    <Chip tone={integrations.whatsapp.simulated ? 'grey' : 'ok'}>{integrations.whatsapp.simulated ? 'Simulator' : 'Live'}</Chip>
                  </span>
                ),
              },
              {
                label: 'Train status',
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="capitalize">{integrations.train.provider}</span>
                    <Chip tone={integrations.train.simulated ? 'grey' : integrations.train.failing ? 'bad' : 'ok'}>
                      {integrations.train.simulated ? 'Simulated' : integrations.train.failing ? 'Failing' : 'Live'}
                    </Chip>
                  </span>
                ),
              },
              { label: 'Proof photos', value: integrations.storage.configured ? `Bucket ${integrations.storage.bucket}` : 'No bucket configured; photo capture is off' },
            ]}
          />
        </Card>
      </div>

      <Notice>
        Company name, logo, KOT header, default walk-to-platform minutes and the inbound mail address become editable per company in the next phase (multi-tenant). Today they are read from the environment of this installation.
      </Notice>
    </div>
  )
}
