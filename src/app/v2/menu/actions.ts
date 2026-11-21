'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { addMenuItem as addMenuItemV1, type MenuState } from '@/app/admin/menu/actions'

/*
 * Thin v2 wrappers: the v1 menu actions revalidate /admin/menu only. Tagging,
 * confirming and deleting deliberately revalidate nothing (the table shows
 * the change itself), so the v2 page imports those from v1 directly.
 */

export async function addMenuItem(prev: MenuState, formData: FormData): Promise<MenuState> {
  const res = await addMenuItemV1(prev, formData)
  if (res.ok) revalidatePath('/v2/menu')
  return res
}

/** Drops the cached v2 Menu page, for a Back after tags saved but not re-read. */
export async function forgetMenuPage(): Promise<void> {
  await requireRole('ADMIN')
  revalidatePath('/v2/menu')
}
