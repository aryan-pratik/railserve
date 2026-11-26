import { requireRole } from '@/lib/session'
import { PageHeader, readPaging } from '@/components/v2/Table'
import { SettingsHome, SettingsSectionHeader, isSettingsTab, type SettingsTabKey } from '@/components/v2/SettingsRail'
import { countStaff, kitchensOnly, loadSetupBase } from '@/lib/v2/settings'
import { CompanyTab } from './CompanyTab'
import { StationsTab } from './StationsTab'
import { OutletsTab } from './OutletsTab'
import { RoutingTab } from './RoutingTab'
import { MailTab } from './MailTab'
import { StaffTab } from './StaffTab'
import { IntegrationsTab } from './IntegrationsTab'
import { RolesTab } from './RolesTab'
import { cookies } from 'next/headers'
import { Card } from '@/components/v2/ui'
import { ThemeSwitch } from '@/components/v2/ThemeSwitch'
import { THEME_COOKIE, readThemeChoice } from '@/lib/v2/theme'
import { TrainsTab } from './TrainsTab'

export const metadata = { title: 'Settings · RailServe' }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/**
 * Settings: a home page of plain choices, and one section at a time (?tab=)
 * with a way back. See SettingsRail for the sections and their wording.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireRole('ADMIN')
  const sp = await searchParams
  const tabParam = one(sp.tab)
  const tab: SettingsTabKey | null = isSettingsTab(tabParam) ? tabParam : null
  const now = new Date()

  const [base, staffCount] = await Promise.all([loadSetupBase(ctx), countStaff(ctx)])
  const kitchens = kitchensOnly(base.outlets, base.listings)

  // No section picked: the Settings home, which only needs a few counts.
  if (!tab) {
    const active = kitchens.filter((k) => k.active).length
    return (
      <div className="grid gap-[18px]">
        <PageHeader title="Settings" note="Pick what you want to change." />
        <SettingsHome
          facts={{
            staff: `${staffCount} ${staffCount === 1 ? 'person' : 'people'}`,
            outlets: `${active} kitchen${active === 1 ? '' : 's'}`,
            stations: `${base.stations.length} station${base.stations.length === 1 ? '' : 's'}`,
          }}
        />
      </div>
    )
  }

  const paging = readPaging(sp)
  return (
    <div className="grid min-w-0 gap-6">
      <SettingsSectionHeader tab={tab} />
      {/* contain:inline-size keeps a wide table from pushing the page sideways:
          the section's intrinsic width is then zero, so TableFrame scrolls on its own. */}
      <div className="min-w-0 [contain:inline-size]">
        {tab === 'company' ? (
          <CompanyTab ctx={ctx} />
        ) : tab === 'stations' ? (
          <StationsTab base={base} kitchens={kitchens} now={now} />
        ) : tab === 'outlets' ? (
          <OutletsTab ctx={ctx} base={base} kitchens={kitchens} paging={paging} />
        ) : tab === 'mail' ? (
          <MailTab ctx={ctx} />
        ) : tab === 'routing' ? (
          <RoutingTab ctx={ctx} base={base} />
        ) : tab === 'staff' ? (
          <StaffTab ctx={ctx} base={base} paging={paging} q={one(sp.q)} role={one(sp.role)} />
        ) : tab === 'screen' ? (
          <Card title="Screen colours" className="max-w-xl">
            <ThemeSwitch initial={readThemeChoice((await cookies()).get(THEME_COOKIE)?.value)} />
          </Card>
        ) : tab === 'roles' ? (
          <RolesTab ctx={ctx} />
        ) : tab === 'integrations' ? (
          <IntegrationsTab ctx={ctx} base={base} now={now} />
        ) : (
          <TrainsTab base={base} now={now} />
        )}
      </div>
    </div>
  )
}
