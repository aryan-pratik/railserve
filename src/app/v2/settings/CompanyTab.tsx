import type { AuthContext } from '@/lib/authContext'
import { can } from '@/lib/access'
import { loadCompany } from '@/lib/repo/companyRepo'
import { CompanyForm } from '@/components/v2/CompanyForm'
import { Card, Chip } from '@/components/v2/ui'

/**
 * Business details: the name and phone an owner recognises, and the plan.
 * What the business is connected to lives under Connections; the counts of
 * kitchens and staff are on the Settings home.
 */
export async function CompanyTab({ ctx }: { ctx: AuthContext }) {
  const [company, canEdit] = await Promise.all([loadCompany(ctx), can(ctx, 'company.manage')])
  return (
    <div className="grid max-w-[760px] gap-3.5">
      <CompanyForm
        canEdit={canEdit}
        values={{
          name: company.name,
          displayName: company.settings.displayName,
          contactPhone: company.settings.contactPhone,
          contactEmail: company.settings.contactEmail,
        }}
      />
      <Card title="Your plan" action={<Chip tone="grey">{company.plan.code}</Chip>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <UsageMeter label="Kitchens" used={company.usage.outlets} limit={company.plan.maxOutlets} />
          <UsageMeter label="Staff accounts" used={company.usage.users} limit={company.plan.maxUsers} />
          <div className="grid content-start gap-1">
            <span className="text-[12.5px] font-semibold text-v2-ink-2">Orders this month</span>
            <span className="font-mono text-2xl font-bold tabular-nums">{company.usage.ordersThisMonth}</span>
          </div>
        </div>
      </Card>
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
