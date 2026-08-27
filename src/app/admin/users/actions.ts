'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { ROLES } from '@/lib/roles'

const UserInput = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, 'Name is required'),
    phone: z.string().trim().min(6, 'Phone is required'),
    role: z.enum(ROLES),
    restaurantId: z.string().optional(),
    password: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'STORE_MANAGER' && !v.restaurantId) {
      ctx.addIssue({
        code: 'custom', path: ['restaurantId'],
        message: 'A store manager must belong to an outlet',
      })
    }
    if (!v.id && !v.password) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Set an initial password' })
    }
  })

export type UserState = { error?: string; ok?: string }

export async function saveUser(_prev: UserState, formData: FormData): Promise<UserState> {
  await requireRole('ADMIN')

  const parsed = UserInput.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }
  const { id, password, restaurantId, ...rest } = parsed.data

  await connectDb()

  // Phone is uniquely indexed and is the login identifier.
  const clash = await User.findOne({
    phone: rest.phone,
    ...(id ? { _id: { $ne: id } } : {}),
  }).select('_id').lean()
  if (clash) return { error: 'That phone number already belongs to another user.' }

  const doc: Record<string, unknown> = {
    ...rest,
    // Only a store manager is scoped to an outlet; the others must be null or
    // the repository would scope them to something meaningless.
    restaurantId: rest.role === 'STORE_MANAGER' ? restaurantId : null,
  }
  if (password) doc.passwordHash = await bcrypt.hash(password, 10)

  if (id) {
    await User.updateOne({ _id: id }, { $set: doc })
  } else {
    await User.create({ ...doc, active: true })
  }

  revalidatePath('/admin/users')
  return { ok: id ? 'Staff member updated.' : 'Staff member created.' }
}

export async function toggleUserActive(formData: FormData) {
  await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'

  await connectDb()
  await User.updateOne({ _id: id }, { $set: { active } })
  revalidatePath('/admin/users')
}
