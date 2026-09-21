'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import mongoose from 'mongoose'
import { PrintJob, Restaurant, User } from '@/lib/models'
import { countOrdersForOutlet } from '@/lib/repo/orderRepo'

const RestaurantInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required'),
  stationCode: z.string().trim().min(2, 'Station code is required').max(5),
  stationName: z.string().trim().optional(),
  aliases: z.string().optional(),
  contactName: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  walkToPlatformMinutes: z.coerce.number().int().min(0).max(120),
})

export type RestaurantState = { error?: string; ok?: string }

export async function saveRestaurant(
  _prev: RestaurantState,
  formData: FormData,
): Promise<RestaurantState> {
  await requireRole('ADMIN')

  const parsed = RestaurantInput.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }
  const { id, aliases, ...rest } = parsed.data

  await connectDb()
  const doc = {
    ...rest,
    stationCode: rest.stationCode.toUpperCase(),
    // Alias variants are how aggregator emails will be matched to this outlet.
    aliases: (aliases ?? '')
      .split(/[\n,]/)
      .map((a) => a.trim())
      .filter(Boolean),
  }

  if (id) {
    await Restaurant.updateOne({ _id: id }, { $set: doc })
  } else {
    await Restaurant.create({ ...doc, active: true })
  }

  revalidatePath('/admin/setup')
  return { ok: id ? 'Outlet updated.' : 'Outlet created.' }
}

/**
 * Plan §2: never hard-delete. An order pointing at a deleted outlet is
 * invisible to every dashboard, with no error raised anywhere.
 */
export async function toggleRestaurantActive(formData: FormData) {
  await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'

  await connectDb()
  await Restaurant.updateOne({ _id: id }, { $set: { active } })
  revalidatePath('/admin/setup')
}

export type DeleteState = { error?: string }

/**
 * Deletes an outlet, but only one nothing points at.
 *
 * The rule above still holds: an order pointing at a deleted outlet vanishes
 * from every dashboard. So this refuses whenever an order, a print job or a
 * staff member still references the outlet, and says which, pointing at
 * deactivation instead. What it is for is the outlet created by mistake or for
 * testing, which nothing ever came to depend on.
 */
export async function deleteRestaurant(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const ctx = await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  if (!mongoose.isValidObjectId(id)) return { error: 'That outlet no longer exists.' }

  await connectDb()
  const [orders, printJobs, staff] = await Promise.all([
    countOrdersForOutlet(ctx, id),
    PrintJob.countDocuments({ restaurantId: id }),
    User.countDocuments({ restaurantIds: id }),
  ])

  const reasons = [
    orders ? `${orders} order${orders === 1 ? '' : 's'}` : null,
    printJobs ? `${printJobs} print job${printJobs === 1 ? '' : 's'}` : null,
    staff ? `${staff} staff member${staff === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  if (reasons.length > 0) {
    return {
      error: `Still used by ${reasons.join(', ')}. Deactivate it instead, so those records stay readable.`,
    }
  }

  await Restaurant.deleteOne({ _id: id })
  revalidatePath('/admin/setup')
  return {}
}
