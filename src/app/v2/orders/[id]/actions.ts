'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/session'
import { deleteOrder } from '@/lib/repo/orderRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import type { OrderStatus } from '@/lib/orderStatus'
import * as admin from '@/app/admin/orders/[id]/actions'
import * as store from '@/app/store/actions'
import * as calls from '@/app/calls/actions'
import * as enquiries from '@/app/admin/enquiries/actions'
import { assignRidersAction } from '@/app/actions/assignRiders'
import { decideCancellationAction, requestCancellationAction } from '@/app/actions/cancelRequests'
import { addCallNoteAction, deleteCallNoteAction, editCallNoteAction, setKotNoteAction } from '@/app/actions/orderNotes'
import { markReturnedAction } from '@/app/actions/returns'

/*
 * The v1 actions revalidate v1 paths only. Each one is wrapped here so the
 * same write also refreshes the v2 workspace and the v2 boards; the rules
 * stay in the v1 action and the repository underneath it.
 */

export type WorkspaceState = { error?: string; ok?: string }

type StateAction<S> = (prev: S, formData: FormData) => Promise<S>

function revalidateV2(orderId: string) {
  revalidatePath(`/v2/orders/${orderId}`)
  revalidatePath('/v2/orders')
  revalidatePath('/v2/kitchen')
  revalidatePath('/v2/calls')
  revalidatePath('/v2/admin')
}

function wrap<S>(action: StateAction<S>): StateAction<S> {
  return async (prev, formData) => {
    const result = await action(prev, formData)
    revalidateV2(String(formData.get('orderId') ?? ''))
    return result
  }
}

// Kitchen
export const acceptOrderV2 = wrap(store.acceptOrder)
export const markPreparedV2 = wrap(store.markPrepared)
export const adminTransitionV2 = wrap(admin.adminTransitionAction)
export const updateOrderItemV2 = wrap(admin.updateOrderItemAction)
export const addOrderItemV2 = wrap(admin.addOrderItemAction)
export const removeOrderItemV2 = wrap(admin.removeOrderItemAction)
export const updateOrderRemarkV2 = wrap(admin.updateOrderRemarkAction)
export const setKotNoteV2 = wrap(setKotNoteAction)
export const forceRefreshOrderTrainV2 = wrap(store.forceRefreshOrderTrain)

export async function checkKotDelayV2(orderId: string) {
  return store.checkKotDelay(orderId)
}

/** Generate KOT: the store action transitions and queues the print. */
export async function generateKotV2(formData: FormData) {
  await store.generateKot(formData)
  revalidateV2(String(formData.get('orderId') ?? ''))
}

// Delivery
export const assignRidersV2 = wrap(assignRidersAction)
export const assignAgentsV2 = wrap(admin.assignAgentsAction)
export const markReturnedV2 = wrap(markReturnedAction)
export const handRunToRiderV2 = wrap(store.handRunToRiderAction)

// Calls
export const cancelOrderV2 = wrap(calls.cancelOrder)
export const markDeliveredV2 = wrap(calls.markDelivered)
export const markNotDeliveredV2 = wrap(calls.markNotDelivered)
export const markMisdeliveryV2 = wrap(calls.markMisdelivery)
export const markMissedDeliveryV2 = wrap(calls.markMissedDelivery)
export const markRefundedV2 = wrap(calls.markRefunded)
export const flagRatingOrderV2 = wrap(calls.flagRatingOrder)
export const requestCancellationV2 = wrap(requestCancellationAction)
export const decideCancellationV2 = wrap(decideCancellationAction)
export const addCallNoteV2 = wrap(addCallNoteAction)
export const editCallNoteV2 = wrap(editCallNoteAction)
export const deleteCallNoteV2 = wrap(deleteCallNoteAction)

// Money and admin
export const updateOrderPaymentModeV2 = wrap(admin.updateOrderPaymentModeAction)
export const editOrderDetailsV2 = wrap(admin.editOrderDetailsAction)
export const overrideStatusV2 = wrap(admin.overrideStatusAction)

// Enquiry
export const quoteEnquiryV2 = wrap(enquiries.quoteEnquiryAction)
export const confirmEnquiryV2 = wrap(enquiries.confirmEnquiryAction)

/**
 * An admin ending an order early, with the reason on the record. The v1
 * admin button carries no reason; this goes through the same transition
 * engine with one, so the kitchen alert and the history can quote it.
 */
export async function adminOutcomeV2(_prev: WorkspaceState, formData: FormData): Promise<WorkspaceState> {
  const ctx = await requirePermission('orders.overrideStatus')
  const orderId = String(formData.get('orderId') ?? '')
  const to = String(formData.get('to') ?? '') as OrderStatus
  const reason = String(formData.get('reason') ?? '').trim()
  if (reason.length < 3) return { error: 'Say briefly why: the kitchen and the history show this.' }
  if (reason.length > 500) return { error: 'Keep the reason under 500 characters.' }
  try {
    await transitionOrder({ ctx, orderId, to, meta: { via: 'admin-detail', reason } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the order.' }
  }
  revalidateV2(orderId)
  revalidatePath('/admin')
  revalidatePath('/store')
  revalidatePath('/calls')
  return { ok: to === 'CANCELLED' ? 'Order cancelled. The kitchen has been told.' : 'Order updated.' }
}

/** Mark lost, with the reason, landing on the enquiries view rather than v1's list. */
export async function markLostV2(_prev: WorkspaceState, formData: FormData): Promise<WorkspaceState> {
  const ctx = await requirePermission('orders.overrideStatus')
  const orderId = String(formData.get('orderId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  try {
    await transitionOrder({ ctx, orderId, to: 'LOST', meta: reason ? { via: 'enquiry', reason } : { via: 'enquiry' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark the enquiry lost.' }
  }
  revalidateV2(orderId)
  revalidatePath('/admin/enquiries')
  redirect('/v2/orders?view=enquiries')
}

/** Permanent. The v1 action redirects to /admin/orders; this one lands on the v2 table. */
export async function deleteOrderV2(_prev: WorkspaceState, formData: FormData): Promise<WorkspaceState> {
  const ctx = await requirePermission('orders.overrideStatus')
  const orderId = String(formData.get('orderId') ?? '')
  let ok: boolean
  try {
    ok = await deleteOrder(ctx, orderId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete the order.' }
  }
  if (!ok) return { error: 'Order not found.' }
  revalidateV2(orderId)
  revalidatePath('/admin/orders')
  revalidatePath('/store')
  redirect('/v2/orders')
}
