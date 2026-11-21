import type { AuthContext } from '@/lib/authContext'
import { can } from '@/lib/access'
import { loadCompany } from '@/lib/repo/companyRepo'
import { CompanyForm } from '@/components/v2/CompanyForm'
import { Card, Chip, Mono } from '@/components/v2/ui'
import { KeyValue, Notice } from '@/components/v2/Table'
import { loadIntegrations, type OutletRow, type loadSetupBase } from '@/lib/v2/settings'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

/**
 * The company's own page: its details (editable with company.manage), its
 * plan and how much of it is used, what it serves, and what it is connected to.
 */
export async function CompanyTab({ ctx, base, kitchens, staffCount }: { ctx: AuthContext; base: Base; kitchens: OutletRow[]; staffCount: number; now: Date }) {
  const [integrations, company, canEdit] = await Promise.all([loadIntegrations(ctx), loadCompany(ctx), can(ctx, 'company.manage')])
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
        <div className="grid gap-3.5">
          <CompanyForm
            canEdit={canEdit}
            values={{
              name: company.name,
              displayName: company.settings.displayName,
              contactPhone: company.settings.contactPhone,
              contactEmail: company.settings.contactEmail,
            }}
          />
          <Card title="Plan and usage" action={<Chip tone="grey">{company.plan.code}</Chip>}>
            <div className="grid gap-3 sm:grid-cols-3">
              <UsageMeter label="Active outlets" used={company.usage.outlets} limit={company.plan.maxOutlets} />
              <UsageMeter label="Active staff accounts" used={company.usage.users} limit={company.plan.maxUsers} />
              <div className="grid content-start gap-1">
                <span className="text-[12.5px] font-semibold text-v2-ink-2">Orders this month</span>
                <span className="font-mono text-2xl font-bold tabular-nums">{company.usage.ordersThisMonth}</span>
              </div>
            </div>
          </Card>
          <Card title="What you serve">
            <KeyValue
              rows={[
                {
                  label: 'Stations',
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
        </div>

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

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const tone = pct >= 100 ? 'bg-v2-bad' : pct >= 80 ? 'bg-v2-warn' : 'bg-v2-brand'
  return (
    <div className="grid content-start gap-1.5">
      <span className="text-[12.5px] font-semibold text-v2-ink-2">{label}</span>
      <span className="font-mono text-2xl font-bold tabular-nums">
        {used}
        <span className="text-sm font-semibold text-v2-muted"> / {limit}</span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-v2-surface-2" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}
