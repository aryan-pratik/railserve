import { Search } from 'lucide-react'
import { QueryForm } from '@/components/QueryForm'
import { Avatar, Button, Chip, Mono, cx } from '@/components/v2/ui'
import { EmptyState, Pagination, Sub, Table, TableFrame, Td, Th, rowClass } from '@/components/v2/Table'
import { inputClass } from '@/components/v2/SettingsForm'
import { Select } from '@/components/v2/Select'
import { SettingsStaffDialog } from '@/components/v2/SettingsStaffDialog'
import { DeleteButton, GuardedActiveToggle } from '@/components/v2/SettingsRowActions'
import { isRole, loadStaff, type loadSetupBase } from '@/lib/v2/settings'
import { ROLE_LABEL, ROLES } from '@/lib/roles'
import { canReceiveCash } from '@/lib/collections'
import { maskPhone } from '@/lib/riderRecords'
import { deleteStaff, toggleStaffActive } from './actions'
import type { AuthContext } from '@/lib/authContext'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

export async function StaffTab({
  ctx,
  base,
  paging,
  q,
  role,
}: {
  ctx: AuthContext
  base: Base
  paging: { page: number; pageSize: number; skip: number }
  q: string
  role: string
}) {
  const roleFilter = isRole(role) ? role : undefined
  const { rows, total, leads } = await loadStaff({ q, role: roleFilter }, { skip: paging.skip, limit: paging.pageSize })
  const leadName = new Map(leads.map((l) => [l.id, l.name]))
  const outletById = new Map(base.outlets.map((o) => [o.id, o]))
  const me = String(ctx.userId)

  // The picker offers active outlets, plus any an edited person already holds
  // even if it was deactivated since, so saving never silently drops it.
  const pickerOutlets = (holding: string[]) =>
    base.outlets
      .filter((o) => o.active || holding.includes(o.id))
      .map((o) => ({ id: o.id, name: o.name, stationCode: o.stationCode, stationName: o.stationName }))
  // Inactive leaders stay in the list, marked: a picker without a rider's
  // current leader would save "No team" on any edit.
  const leadOptions = leads.map((l) => ({ id: l.id, name: l.active ? l.name : `${l.name} (inactive)` }))

  const buildHref = ({ page, pageSize }: { page: number; pageSize: number }) => {
    const u = new URLSearchParams({ tab: 'staff' })
    if (q) u.set('q', q)
    if (roleFilter) u.set('role', roleFilter)
    if (page > 1) u.set('page', String(page))
    if (pageSize !== 20) u.set('pageSize', String(pageSize))
    return `/v2/settings?${u.toString()}`
  }

  return (
    // Fills the tab: filters and the column header stay put, only the rows scroll, the pager sits at the foot.
    <div className="grid gap-3.5 xl:h-full xl:grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <QueryForm className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="staff" />
          {paging.pageSize !== 20 ? <input type="hidden" name="pageSize" value={paging.pageSize} /> : null}
          <label className="grid gap-1 text-[12.5px] font-semibold text-v2-ink-2">
            Search
            <span className="relative block">
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-v2-faint" />
              <input name="q" defaultValue={q} placeholder="Name or phone" className={cx(inputClass, 'w-56 pl-9')} />
            </span>
          </label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-v2-ink-2">
            Role
            <Select
              name="role"
              defaultValue={roleFilter ?? ''}
              aria-label="Role"
              className="w-44"
              buttonClassName="rounded-v2-md border-v2-line-strong"
              options={[{ value: '', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]}
            />
          </label>
          <Button type="submit">Apply</Button>
        </QueryForm>
        <SettingsStaffDialog outlets={pickerOutlets([])} teamLeads={leadOptions} />
      </div>

      {total === 0 ? (
        <EmptyState
          title={q || roleFilter ? 'Nobody matches' : 'No staff yet'}
          note={q || roleFilter ? 'Try a shorter name, or clear the role filter.' : 'Add the first store manager, rider or telecaller.'}
        />
      ) : (
        <TableFrame className="relative flex min-h-0 flex-col overflow-hidden!">
          <div className="min-h-0 flex-1 overflow-auto [overscroll-behavior:contain] [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10">
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Phone</Th>
                <Th>Role</Th>
                <Th>Outlets</Th>
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const lead = u.role === 'DELIVERY_AGENT' && u.isTeamLead
                const team = u.role === 'DELIVERY_AGENT' && !lead && u.teamLeadId ? leadName.get(u.teamLeadId) : null
                const receivesCash = u.role !== 'ADMIN' && canReceiveCash({ role: u.role, isTeamLead: u.isTeamLead, canReceiveCash: u.canReceiveCash })
                const outlets = u.restaurantIds.map((id) => outletById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof outletById.get>>[]
                return (
                  <tr key={u.id} className={rowClass()}>
                    <Td className={u.active ? '' : 'text-v2-muted'}>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={u.name} size={32} className={u.active ? '' : 'opacity-50 grayscale'} />
                        <span className="min-w-0">
                          <span className="block font-semibold">
                            {u.name}
                            {u.id === me ? <span className="ml-1.5 text-xs font-medium text-v2-muted">(you)</span> : null}
                          </span>
                          {team ? <Sub>team {team}</Sub> : null}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <Mono className="text-v2-ink-2">{maskPhone(u.phone) ?? u.phone}</Mono>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        <Chip tone={u.role === 'ADMIN' ? 'info' : 'grey'}>{lead ? 'Rider team leader' : ROLE_LABEL[u.role]}</Chip>
                        {u.role === 'STORE_MANAGER' && u.canCollectReturns ? <Chip tone="ok">collects returns</Chip> : null}
                        {receivesCash ? <Chip tone="cod">receives cash</Chip> : null}
                      </span>
                    </Td>
                    <Td className="max-w-[24ch] whitespace-normal">
                      {u.role === 'ADMIN' ? (
                        <span className="text-xs text-v2-faint">All outlets</span>
                      ) : outlets.length === 0 ? (
                        <span className="text-xs text-v2-bad">none</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {outlets.map((o) => (
                            <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-v2-surface-2 px-2 py-0.5 text-xs ring-1 ring-inset ring-v2-line">
                              <Mono className="text-[11px] font-semibold text-v2-muted">{o.stationCode}</Mono>
                              {o.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <GuardedActiveToggle id={u.id} active={u.active} name={u.name} action={toggleStaffActive} />
                    </Td>
                    <Td align="right" className="whitespace-nowrap pl-0">
                      <span className="inline-flex items-center justify-end gap-0.5">
                        <SettingsStaffDialog
                          outlets={pickerOutlets(u.restaurantIds)}
                          teamLeads={leadOptions}
                          values={{
                            id: u.id,
                            name: u.name,
                            phone: u.phone,
                            role: u.role,
                            restaurantIds: u.restaurantIds,
                            canCollectReturns: u.canCollectReturns,
                            isTeamLead: u.isTeamLead,
                            teamLeadId: u.teamLeadId,
                            canReceiveCash: u.canReceiveCash,
                          }}
                        />
                        <DeleteButton id={u.id} name={u.name} noun="staff member" action={deleteStaff} />
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          </div>
          <Pagination page={paging.page} pageSize={paging.pageSize} total={total} buildHref={buildHref} className="shrink-0 border-t border-v2-line" />
        </TableFrame>
      )}
    </div>
  )
}
