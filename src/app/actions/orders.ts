'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { createManualOrder } from '@/lib/repo/createOrder'
import { createOrderFromPaste } from '@/lib/ingest/paste'
import { manualOrderFromFormData } from '@/lib/validation/orderForm'
import { ROLE_PREFIX } from '@/lib/roles'
import type { ComposerState } from '@/components/OrderComposer'

/**
 * Order creation for both consoles.
 *
 * An admin and a store manager create the same order in the same way; the only
 * difference is which board they land back on. createManualOrder already
 * refuses an outlet the caller does not hold, so there is nothing role-specific
 * left to duplicate into two copies of this file.
 */
export async function pasteOrderAction(
  _prev: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER')

  const result = await createOrderFromPaste(ctx, String(formData.get('body') ?? ''))
  if (!result.ok) return { error: result.detail }

  revalidatePath(ROLE_PREFIX[ctx.role])
  redirect(`${ROLE_PREFIX[ctx.role]}/orders/${result.orderId}`)
}

export async function createOrderAction(
  _prev: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER')

  const parsed = manualOrderFromFormData(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  let orderId: string
  try {
    const doc = await createManualOrder(ctx, parsed.data)
    orderId = String(doc._id)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the order.' }
  }

  revalidatePath(ROLE_PREFIX[ctx.role])
  redirect(`${ROLE_PREFIX[ctx.role]}/orders/${orderId}`)
}
