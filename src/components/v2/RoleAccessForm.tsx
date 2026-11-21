'use client'

import { useActionState, useMemo, useState } from 'react'
import { saveRoleAccess, type CompanyState } from '@/app/v2/settings/companyActions'
import { PERMISSIONS, PERMISSION_GROUPS, ROLE_PRESETS, isAdjustable, type Permission } from '@/lib/permissions'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { Button, Card, Chip, cx } from './ui'
import { Notice } from './Table'

const initial: CompanyState = {}

/**
 * Who may do what. One row per permission, one column per role. Admins always
 * have everything and riders only ever deliver, so those two columns are
 * shown for reference and cannot be changed. A cell that differs from the
 * role's default is marked, so an owner can see at a glance what they changed.
 */
export function RoleAccessForm({
  editableRoles,
  granted,
  canEdit,
}: {
  editableRoles: Role[]
  /** role -> the permissions it has now (preset plus this tenant's overrides). */
  granted: Record<Role, Permission[]>
  canEdit: boolean
}) {
  const [state, action, pending] = useActionState(saveRoleAccess, initial)
  const [on, setOn] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const role of editableRoles) for (const p of granted[role] ?? []) s.add(`${role}:${p}`)
    return s
  })
  const changed = useMemo(() => {
    let n = 0
    for (const role of editableRoles) {
      const now = new Set(granted[role])
      for (const g of PERMISSION_GROUPS) for (const p of g.permissions) if (now.has(p) !== on.has(`${role}:${p}`)) n += 1
    }
    return n
  }, [on, editableRoles, granted])

  const columns: { role: Role; editable: boolean }[] = [
    { role: 'ADMIN', editable: false },
    ...editableRoles.map((role) => ({ role, editable: canEdit })),
    { role: 'DELIVERY_AGENT', editable: false },
  ]

  return (
    <Card title="Roles & access">
      <p className="-mt-2 text-sm text-v2-muted">
        Switch abilities off for store managers and telecallers, or back on. Greyed boxes are fixed for now. Outlet limits still apply: a store manager only ever sees their own outlets.
      </p>
      <form action={action} className="grid gap-4">
        {[...on].filter((v) => { const [r, p] = v.split(':') as [Role, Permission]; return isAdjustable(r, p) }).map((v) => (
          <input key={v} type="hidden" name="perm" value={v} />
        ))}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-v2-surface py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-v2-muted">Ability</th>
                {columns.map((c) => (
                  <th key={c.role} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-v2-muted">
                    {ROLE_LABEL[c.role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <GroupRows key={g.label} label={g.label} perms={g.permissions.filter((p) => p !== 'roles.manage')} columns={columns} on={on} setOn={setOn} />
              ))}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending || changed === 0}>
              {pending ? 'Saving…' : changed ? `Save ${changed} change${changed === 1 ? '' : 's'}` : 'No changes'}
            </Button>
            {state.error ? <Notice tone="bad">{state.error}</Notice> : state.ok ? <Notice tone="ok">{state.ok}</Notice> : null}
          </div>
        ) : null}
      </form>
    </Card>
  )
}

function GroupRows({
  label,
  perms,
  columns,
  on,
  setOn,
}: {
  label: string
  perms: Permission[]
  columns: { role: Role; editable: boolean }[]
  on: Set<string>
  setOn: (f: (s: Set<string>) => Set<string>) => void
}) {
  return (
    <>
      <tr>
        <td colSpan={columns.length + 1} className="pb-1 pt-4 text-[12.5px] font-bold text-v2-ink">
          {label}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p} className="border-t border-v2-line">
          <td className="sticky left-0 border-t border-v2-line bg-v2-surface py-2 pr-3 text-v2-ink-2">{PERMISSIONS[p]}</td>
          {columns.map((c) => {
            const key = `${c.role}:${p}`
            const fixed = !c.editable || !isAdjustable(c.role, p)
            const checked = c.role === 'ADMIN' ? true : c.role === 'DELIVERY_AGENT' ? p === 'delivery.operate' : on.has(key)
            const isDefault = (ROLE_PRESETS[c.role] as readonly string[]).includes(p) === checked
            return (
              <td key={c.role} className="border-t border-v2-line px-2 py-2 text-center">
                <span className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    aria-label={`${ROLE_LABEL[c.role]}: ${PERMISSIONS[p]}`}
                    checked={checked}
                    disabled={fixed}
                    onChange={(e) =>
                      setOn((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(key)
                        else next.delete(key)
                        return next
                      })
                    }
                    className={cx('size-4 accent-v2-brand', fixed && 'opacity-60')}
                  />
                  {!fixed && !isDefault ? <Chip tone="info">changed</Chip> : null}
                </span>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
