'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import mongoose from 'mongoose'
import { Payment, UnparsedInbox, User } from '@/lib/models'
import { countOrdersRecordingUser } from '@/lib/repo/orderRepo'
import { ROLES } from '@/lib/roles'

const UserInput = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, 'Name is required'),
    phone: z.string().trim().min(6, 'Phone is required'),
    role: z.enum(ROLES),
    restaurantIds: z.array(z.string()).default([]),
    password: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    // Every scoped role needs at least one outlet: a manager or telecaller
    // cannot log in without one, and a rider would see an empty board forever.
    if (v.role !== 'ADMIN' && v.restaurantIds.length === 0) {
      ctx.addIssue({
        code: 'custom', path: ['restaurantIds'],
        message:
          v.role === 'STORE_MANAGER'
            ? 'A store manager must hold at least one outlet'
            : v.role === 'TELECALLER'
              ? 'A telecaller must be attached to at least one outlet, or their call list will be empty'
              : 'A rider must be attached to at least one outlet, or their app will be empty',
      })
    }
    if (!v.id && !v.password) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Set an initial password' })
    }
  })

export type UserState = { error?: string; ok?: string }

/**
 * A store manager may only touch their own riders. Both directions matter:
 * refusing to CREATE anything but a DELIVERY_AGENT at their own outlet(s)
 * stops them minting themselves a telecaller or another manager, and
 * refusing to EDIT any user that is not already a rider at one of their
 * outlets stops "editing" from being a way to quietly take over someone
 * else's account. Returns an error string, or null when the action may
 * proceed.
 */
async function storeManagerGuard(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  target: { id?: string; role: string; restaurantIds: string[] },
): Promise<string | null> {
  if (ctx.role !== 'STORE_MANAGER') return null

  if (target.role !== 'DELIVERY_AGENT') {
    return 'A store manager may only add or edit riders.'
  }
  const myOutlets = new Set(ctx.restaurantIds.map(String))
  if (!target.restaurantIds.every((id) => myOutlets.has(id))) {
    return 'You may only assign outlets you hold yourself.'
  }
  if (target.id) {
    const existing = await User.findById(target.id).select('role restaurantIds').lean()
    if (
      !existing ||
      existing.role !== 'DELIVERY_AGENT' ||
      !existing.restaurantIds.some((id) => myOutlets.has(String(id)))
    ) {
      return 'That staff member is not a rider at one of your outlets.'
    }
  }
  return null
}

export async function saveUser(_prev: UserState, formData: FormData): Promise<UserState> {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER')

  // getAll, not Object.fromEntries — a multi-select posts one entry per outlet
  // and fromEntries would silently keep only the last.
  const parsed = UserInput.safeParse({
    ...Object.fromEntries(formData),
    restaurantIds: formData.getAll('restaurantIds').map(String).filter(Boolean),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }
  const { id, password, restaurantIds, ...rest } = parsed.data

  await connectDb()

  const guardError = await storeManagerGuard(ctx, { id, role: rest.role, restaurantIds })
  if (guardError) return { error: guardError }

  // Phone is uniquely indexed and is the login identifier.
  const clash = await User.findOne({
    phone: rest.phone,
    ...(id ? { _id: { $ne: id } } : {}),
  }).select('_id').lean()
  if (clash) return { error: 'That phone number already belongs to another user.' }

  const doc: Record<string, unknown> = {
    ...rest,
    // Admins are scoped by role, not by outlet, so theirs stays empty — the
    // repository would otherwise narrow them to something meaningless.
    restaurantIds: rest.role === 'ADMIN' ? [] : restaurantIds,
  }
  if (password) doc.passwordHash = await bcrypt.hash(password, 10)

  if (id) {
    await User.updateOne({ _id: id }, { $set: doc })
  } else {
    await User.create({ ...doc, active: true })
  }

  revalidatePath('/admin/setup')
  revalidatePath('/store/staff')
  return { ok: id ? 'Staff member updated.' : 'Staff member created.' }
}

/**
 * Kept `Promise<void>` — the same shape it always had — because it is bound
 * straight to a plain `<form action>`, whose intrinsic type does not accept
 * a function returning anything else. A store manager only ever sees this
 * button next to their own riders (the page's query already scopes the
 * list), so the refusal below is defence in depth against a forged request,
 * not something the UI needs to surface: it just quietly does nothing.
 */
export async function toggleUserActive(formData: FormData): Promise<void> {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER')
  const id = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'

  await connectDb()

  if (ctx.role === 'STORE_MANAGER') {
    const target = await User.findById(id).select('role restaurantIds').lean()
    const myOutlets = new Set(ctx.restaurantIds.map(String))
    if (
      !target ||
      target.role !== 'DELIVERY_AGENT' ||
      !target.restaurantIds.some((rid) => myOutlets.has(String(rid)))
    ) {
      return
    }
  }

  await User.updateOne({ _id: id }, { $set: { active } })
  revalidatePath('/admin/setup')
  revalidatePath('/store/staff')
}

export type DeleteState = { error?: string }

/**
 * Deletes a staff member, but only one nothing records.
 *
 * Their id is written into order events, call notes, deliveries, order
 * creation, payment remarks and inbox resolutions. Deleting someone any of
 * those point at turns them into "Unknown user" in every log they appear in,
 * so this refuses and points at deactivation, which blocks the login and keeps
 * the name. It also refuses to delete yourself, or the last active admin,
 * either of which can lock everybody out of this page.
 */
export async function deleteUser(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  // Admin-only, on purpose: the store manager's Riders page has no delete
  // control at all — only deactivate — so this stays out of reach of
  // STORE_MANAGER entirely rather than being merely unreachable through the UI.
  const ctx = await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  if (!mongoose.isValidObjectId(id)) return { error: 'That staff member no longer exists.' }
  if (ctx.userId.equals(id)) return { error: "You can't delete your own account." }

  await connectDb()
  const target = await User.findById(id).select('role active restaurantIds').lean()
  if (!target) return { error: 'That staff member no longer exists.' }

  if (target.role === 'ADMIN' && target.active) {
    const admins = await User.countDocuments({ role: 'ADMIN', active: true })
    if (admins <= 1) return { error: 'This is the last active admin. Deleting them would lock everyone out.' }
  }

  const [orders, remarks, resolved] = await Promise.all([
    countOrdersRecordingUser(ctx, id),
    Payment.countDocuments({ remarkById: id }),
    UnparsedInbox.countDocuments({ resolvedById: id }),
  ])
  const reasons = [
    orders ? `${orders} order${orders === 1 ? '' : 's'}` : null,
    remarks ? `${remarks} payment remark${remarks === 1 ? '' : 's'}` : null,
    resolved ? `${resolved} inbox item${resolved === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  if (reasons.length > 0) {
    return {
      error: `Their name is on ${reasons.join(', ')}. Deactivate them instead, which blocks the login and keeps those records readable.`,
    }
  }

  await User.deleteOne({ _id: id })
  revalidatePath('/admin/setup')
  revalidatePath('/store/staff')
  return {}
}
