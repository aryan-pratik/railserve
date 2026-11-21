import { requireRole } from '@/lib/session'
import { PageHeader, readPaging } from '@/components/v2/Table'
import { SettingsRail, SETTINGS_TABS, isSettingsTab, type SettingsTabKey } from '@/components/v2/SettingsRail'
import { countStaff, kitchensOnly, loadSetupBase } from '@/lib/v2/settings'
import { CompanyTab } from './CompanyTab'
import { StationsTab } from './StationsTab'
import { OutletsTab } from './OutletsTab'
import { RoutingTab } from './RoutingTab'
import { StaffTab } from './StaffTab'
import { IntegrationsTab } from './IntegrationsTab'
import { RolesTab } from './RolesTab'
import { TrainsTab } from './TrainsTab'

export const metadata = { title: 'Settings · RailServe' }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/**
 * Settings: one page, seven tabs in the URL. Replaces /admin/setup (Outlets,
 * Aggregators, Staff) and /admin/trains, and adds the Company, Stations and
 * Integrations views that the multi-tenant phase will make editable.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireRole('ADMIN')
  const sp = await searchParams
  const tabParam = one(sp.tab)
  const tab: SettingsTabKey = isSettingsTab(tabParam) ? tabParam : 'company'
  const now = new Date()

  // The base rows feed every tab (the rail's counts, the station lists, the
  // outlet pickers), so they load once here.
  const [base, staffCount] = await Promise.all([loadSetupBase(ctx), countStaff(ctx)])
  const kitchens = kitchensOnly(base.outlets, base.listings)
  const paging = readPaging(sp)

  const meta = SETTINGS_TABS.find((t) => t.key === tab)!

  return (
    // On a desktop the page fills the panel: header and tab rail stay put and
    // only the chosen tab's content scrolls.
    <div className="grid gap-[18px] xl:h-full xl:grid-rows-[auto_minmax(0,1fr)]">
      <PageHeader title="Settings" note={meta.note} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] gap-3.5 xl:grid-cols-[228px_minmax(0,1fr)]">
        <SettingsRail
          active={tab}
          counts={{
            stations: base.stations.length,
            outlets: kitchens.filter((k) => k.active).length,
            staff: staffCount,
          }}
        />
        {/* contain:inline-size keeps a wide table from pushing the page sideways:
            the tab's intrinsic width is then zero, so TableFrame scrolls on its own. */}
        <div className="min-h-0 min-w-0 [contain:inline-size] xl:overflow-y-auto xl:[overscroll-behavior:contain] xl:-mr-2 xl:pr-2">
          {tab === 'company' ? (
            <CompanyTab ctx={ctx} base={base} kitchens={kitchens} staffCount={staffCount} now={now} />
          ) : tab === 'stations' ? (
            <StationsTab base={base} kitchens={kitchens} now={now} />
          ) : tab === 'outlets' ? (
            <OutletsTab ctx={ctx} base={base} kitchens={kitchens} paging={paging} />
          ) : tab === 'routing' ? (
            <RoutingTab ctx={ctx} base={base} />
          ) : tab === 'staff' ? (
            <StaffTab ctx={ctx} base={base} paging={paging} q={one(sp.q)} role={one(sp.role)} />
          ) : tab === 'roles' ? (
            <RolesTab ctx={ctx} />
          ) : tab === 'integrations' ? (
            <IntegrationsTab ctx={ctx} base={base} now={now} />
          ) : (
            <TrainsTab base={base} now={now} />
          )}
        </div>
      </div>
    </div>
  )
}
