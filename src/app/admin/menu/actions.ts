'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { MenuItem } from '@/lib/models'
import { confirmMenuItems, setMenuItemDiet } from '@/lib/repo/menuRepo'
import { isDiet, menuKey } from '@/lib/diet'
import { ORDER_SOURCES, type OrderSource } from '@/lib/orderEnums'

/**
 * Actions behind the Menu page: tagging a dish veg or non-veg, accepting the
 * suggested tags, and adding a dish before its first order arrives.
 * Admin-only, like the page.
 */

export type MenuState = { error?: string; ok?: string }

/** Tag one dish. An empty diet clears the tag, which puts it back under "Not tagged". */
export async function tagMenuItem(id: string, diet: string): Promise<MenuState> {
  const ctx = await requireRole('ADMIN')
  if (diet !== '' && !isDiet(diet)) return { error: 'Unknown tag' }
  try {
    await setMenuItemDiet(ctx, id, diet === '' ? null : diet)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save' }
  }
  revalidatePath('/admin/menu')
  return { ok: 'Saved' }
}

/** Accept the suggested tag on every one of these rows as it stands. */
export async function confirmSuggested(ids: string[]): Promise<MenuState> {
  const ctx = await requireRole('ADMIN')
  const n = await confirmMenuItems(ctx, ids)
  revalidatePath('/admin/menu')
  return { ok: `${n} item${n === 1 ? '' : 's'} confirmed` }
}

/** Add a dish by hand, already tagged, so its first order prints on the right KOT. */
export async function addMenuItem(_prev: MenuState, formData: FormData): Promise<MenuState> {
  const ctx = await requireRole('ADMIN')
  const source = String(formData.get('source') ?? '')
  const name = String(formData.get('name') ?? '').trim().replace(/\s+/g, ' ')
  const diet = String(formData.get('diet') ?? '')

  if (!(ORDER_SOURCES as readonly string[]).includes(source)) return { error: 'Pick an aggregator.' }
  const key = menuKey(name)
  if (!key) return { error: 'Type the item name.' }
  if (name.length > 200) return { error: 'That name is too long.' }
  if (!isDiet(diet)) return { error: 'Pick veg or non-veg.' }

  await connectDb()
  const existing = await MenuItem.findOne({ source: source as OrderSource, key }).select('_id').lean()
  if (existing) return { error: 'That item is already on this aggregator\'s menu.' }
  await MenuItem.create({
    source: source as OrderSource, key, name, diet, reviewed: true, reviewedBy: ctx.userId, reviewedAt: new Date(),
  })
  revalidatePath('/admin/menu')
  return { ok: `${name} added.` }
}
