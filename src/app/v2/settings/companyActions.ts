'use server'

import { revalidatePath } from 'next/cache'
import { connectDb } from '@/lib/db'
import { Tenant } from '@/lib/models'
import { requirePermission } from '@/lib/session'
import { forgetTenantAccess } from '@/lib/access'
import { ALL_PERMISSIONS, EDITABLE_ROLES, ROLE_PRESETS, isAdjustable, type Permission, type RoleOverrides } from '@/lib/permissions'

export type CompanyState = { ok?: string; error?: string }

const clean = (v: FormDataEntryValue | null, max: number) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ')
  return s ? s.slice(0, max) : null
}

/** Company details as the customer sees and prints them. */
export async function saveCompany(_prev: CompanyState, formData: FormData): Promise<CompanyState> {
  const ctx = await requirePermission('company.manage')
  const name = clean(formData.get('name'), 120)
  if (!name) return { error: 'The company needs a name.' }
  const email = clean(formData.get('contactEmail'), 160)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address does not look right.' }
  const phone = clean(formData.get('contactPhone'), 20)
  if (phone && !/^[+\d][\d\s-]{6,}$/.test(phone)) return { error: 'That phone number does not look right.' }

  await connectDb()
  await Tenant.updateOne(
    { _id: ctx.tenantId },
    {
      $set: {
        name,
        'settings.displayName': clean(formData.get('displayName'), 120),
        'settings.contactPhone': phone,
        'settings.contactEmail': email,
      },
    },
  )
  revalidatePath('/v2', 'layout')
  return { ok: 'Saved.' }
}

/**
 * Saves the Roles & access matrix. The form posts one checkbox per role and
 * permission (`STORE_MANAGER:orders.create`); what is stored is only the
 * difference from the preset, so a later change to the presets still reaches
 * every permission a tenant never touched.
 */
export async function saveRoleAccess(_prev: CompanyState, formData: FormData): Promise<CompanyState> {
  const ctx = await requirePermission('roles.manage')
  const checked = new Set(formData.getAll('perm').map(String))
  const overrides: RoleOverrides = {}
  for (const role of EDITABLE_ROLES) {
    const preset = new Set<Permission>(ROLE_PRESETS[role])
    const grant: Permission[] = []
    const revoke: Permission[] = []
    for (const p of ALL_PERMISSIONS) {
      // Only what the grid offers is stored; anything else keeps its default.
      if (!isAdjustable(role, p)) continue
      const on = checked.has(`${role}:${p}`)
      if (on && !preset.has(p)) grant.push(p)
      if (!on && preset.has(p)) revoke.push(p)
    }
    if (grant.length || revoke.length) overrides[role] = { grant, revoke }
  }

  await connectDb()
  await Tenant.updateOne({ _id: ctx.tenantId }, { $set: { roleOverrides: overrides } })
  forgetTenantAccess(ctx.tenantId)
  revalidatePath('/v2', 'layout')
  return { ok: 'Access saved. It applies to everyone in these roles on their next page.' }
}
