'use server'

import { revalidatePath } from 'next/cache'
import { requireRole, requirePermission } from '@/lib/session'
import { markPaidOnline, recordHandIn, settleRiderCash } from '@/lib/repo/riderCashRepo'
import { setTeam } from '@/lib/repo/teamRepo'
import { saveUser, toggleUserActive, type UserState } from '@/app/admin/setup/staffActions'
import { formatRupees } from '@/lib/format'

/*
 * Thin v2 wrappers. The rules all live in the repositories and the v1 staff
 * actions; these only pin the role, call through, and revalidate the v2
 * routes the v1 actions do not know about.
 */

export type FormState = { error?: string; ok?: string }

function revalidateRiders() {
  revalidatePath('/v2/money')
  revalidatePath('/v2/riders')
  revalidatePath('/v2/riders/teams')
  revalidatePath('/v2/riders/[id]', 'page')
}

/** Take a rider's cash: exactly the orders the dialog listed. */
export async function collectRiderCashV2(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requirePermission('riders.collectCash')
  const riderId = String(formData.get('riderId') ?? '')
  const orderIds = String(formData.get('orderIds') ?? '').split(',').filter(Boolean)
  // Whole rupees typed by the receiver; blank means everything due.
  const rupees = String(formData.get('rupees') ?? '').trim()
  const paise = rupees ? Math.round(Number(rupees) * 100) : undefined
  if (rupees && (!Number.isFinite(paise) || (paise ?? 0) <= 0)) return { error: 'Enter the amount received, in rupees.' }
  try {
    const r = await settleRiderCash({ ctx, riderId, orderIds, paise })
    revalidateRiders()
    revalidatePath('/store/staff')
    revalidatePath('/admin/riders')
    const cleared = `${r.orders} order${r.orders === 1 ? '' : 's'} cleared`
    const part = r.partial ? ` · ${formatRupees(r.partial.leftPaise)} still due on the next order` : ''
    return { ok: `Received ${formatRupees(r.paise)} · ${cleared}${part}.` }
  } catch (err) {
    revalidateRiders()
    return { error: err instanceof Error ? err.message : 'Could not record the handover.' }
  }
}

/** Add or edit a rider. The role is pinned here, whatever the form posted. */
export async function saveRiderV2(_prev: UserState, formData: FormData): Promise<UserState> {
  await requirePermission('riders.manage')
  formData.set('role', 'DELIVERY_AGENT')
  const result = await saveUser(_prev, formData)
  if (result.ok) revalidateRiders()
  return result
}

export async function toggleRiderActiveV2(formData: FormData): Promise<void> {
  await requirePermission('riders.manage')
  await toggleUserActive(formData)
  revalidateRiders()
}

/** Move the ticked riders under a team leader, or out of any team. */
export async function setTeamV2(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireRole('ADMIN')
  const riderIds = formData.getAll('riderIds').map(String).filter(Boolean)
  const lead = String(formData.get('leadId') ?? '')
  try {
    const r = await setTeam({ ctx, riderIds, leadId: lead || null })
    revalidateRiders()
    revalidatePath('/admin/riders/teams')
    revalidatePath('/admin/setup')
    return { ok: `${r.moved} rider${r.moved === 1 ? '' : 's'} moved.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not move those riders.' }
  }
}

/** The passenger paid this cash order online (UPI): the rider no longer owes it. */
export async function markPaidOnlineV2(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requirePermission('riders.collectCash')
  const orderId = String(formData.get('orderId') ?? '')
  try {
    const r = await markPaidOnline({ ctx, orderId })
    revalidateRiders()
    revalidatePath('/v2/orders/[id]', 'page')
    return { ok: `${formatRupees(r.paise)} marked as paid online.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record that.' }
  }
}

/** The owner received cash a store manager or team leader was holding. */
export async function recordHandInV2(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireRole('ADMIN')
  const fromUserId = String(formData.get('fromUserId') ?? '')
  const rupees = String(formData.get('rupees') ?? '').trim()
  const paise = Math.round(Number(rupees) * 100)
  if (!rupees || !Number.isFinite(paise) || paise <= 0) return { error: 'Enter the amount received, in rupees.' }
  try {
    const r = await recordHandIn({ ctx, fromUserId, paise, note: String(formData.get('note') ?? '') })
    revalidatePath('/v2/money')
    return { ok: `Received ${formatRupees(r.paise)}.${r.leftPaise > 0 ? ` ${formatRupees(r.leftPaise)} is still with them.` : ''}` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record that.' }
  }
}
