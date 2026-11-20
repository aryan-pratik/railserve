'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { MenuItem } from '@/lib/models'
import { confirmMenuItems, removeMenuItem, restoreMenuItem, setMenuItemDiet } from '@/lib/repo/menuRepo'
import { isDiet, isMenuDish, menuKey, menuLookupKey } from '@/lib/diet'
import { ORDER_SOURCES, type OrderSource } from '@/lib/orderEnums'

/**
 * Actions behind the Menu page: tagging a dish veg or non-veg, accepting the
 * suggested tags, adding a dish before its first order arrives, and deleting
 * one that should not be listed.
 * Admin-only, like the page.
 */

export type MenuState = { error?: string; ok?: string }

/**
 * What tagging returns. `at` is this server's clock just after the write.
 * The page carries the same clock from just before it read the menu
 * (`asOf`), so the board can tell whether the rows it holds already include
 * this change or were read before it.
 */
export type TagResult = { error: string } | { ok: string; at: number }

/**
 * Tag one dish. An empty diet clears the tag, which puts it back under "Not tagged".
 *
 * Deliberately does not revalidate the page: that would re-read every order
 * to recount the menu on each click, and tagging is a job of hundreds of
 * clicks. The board shows the change itself and refreshes once the clicking
 * pauses.
 */
export async function tagMenuItem(id: string, diet: string): Promise<TagResult> {
  const ctx = await requireRole('ADMIN')
  if (diet !== '' && !isDiet(diet)) return { error: 'Unknown tag' }
  try {
    await setMenuItemDiet(ctx, id, diet === '' ? null : diet)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save' }
  }
  return { ok: 'Saved', at: Date.now() }
}

/**
 * Drops every cached copy of the Menu page. Called when the board is left
 * with saved tags it had not re-read yet, so that coming Back to it does not
 * show the page as it was before those tags.
 */
export async function forgetMenuPage(): Promise<void> {
  await requireRole('ADMIN')
  revalidatePath('/admin/menu')
}

/** Accept the suggested tag on every one of these rows as it stands. */
export async function confirmSuggested(ids: string[]): Promise<TagResult> {
  const ctx = await requireRole('ADMIN')
  try {
    const n = await confirmMenuItems(ctx, ids)
    return { ok: `${n} item${n === 1 ? '' : 's'} confirmed`, at: Date.now() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not confirm' }
  }
}

/**
 * Delete a dish from the Menu page. Like tagging, it does not revalidate:
 * the board hides the row itself and re-reads once the clicking pauses.
 */
export async function deleteMenuItem(id: string): Promise<TagResult> {
  const ctx = await requireRole('ADMIN')
  try {
    await removeMenuItem(ctx, id)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete' }
  }
  return { ok: 'Deleted', at: Date.now() }
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
  if (!isMenuDish({ name })) return { error: 'A bulk thali is tagged on its order, not here.' }

  await connectDb()
  try {
    // The _id is the (aggregator, dish) pair, so a dish that is already
    // there is refused by the database itself, not by a check that another
    // request could slip past.
    await MenuItem.create({
      _id: menuLookupKey(source, name),
      source: source as OrderSource, key, name, diet, reviewed: true, reviewedBy: ctx.userId, reviewedAt: new Date(),
    })
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err
    // The row is there. If it is one that was deleted, adding it again puts
    // it back with the tag picked now.
    if (!(await restoreMenuItem(ctx, menuLookupKey(source, name), name, diet))) {
      return { error: 'That item is already on this aggregator\'s menu.' }
    }
  }
  revalidatePath('/admin/menu')
  return { ok: `${name} added.` }
}
