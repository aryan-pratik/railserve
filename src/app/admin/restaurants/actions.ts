'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'

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

  revalidatePath('/admin/restaurants')
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
  revalidatePath('/admin/restaurants')
}
