'use server'

import { revalidatePath } from 'next/cache'
import { addCallNoteAction, type CallNoteState } from '@/app/actions/orderNotes'
import { cancelOrder, type CallActionState } from '@/app/calls/actions'

/*
 * Thin v2 wrappers. The v1 actions hold the rules and revalidate the v1
 * screens; these call them unchanged and add the v2 paths an order can be
 * visible on, so the call board redraws after its own mutation.
 */

function revalidateV2(orderId: string) {
  revalidatePath('/v2/calls')
  revalidatePath('/v2/orders')
  revalidatePath(`/v2/orders/${orderId}`)
  revalidatePath('/v2/kitchen')
  revalidatePath('/v2/admin')
}

export async function addCallNoteV2(prev: CallNoteState, formData: FormData): Promise<CallNoteState> {
  const result = await addCallNoteAction(prev, formData)
  if (result.savedAt) revalidateV2(String(formData.get('orderId') ?? ''))
  return result
}

export async function cancelFromCallBoard(prev: CallActionState, formData: FormData): Promise<CallActionState> {
  const result = await cancelOrder(prev, formData)
  if (result.ok) revalidateV2(String(formData.get('orderId') ?? ''))
  return result
}
