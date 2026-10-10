'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { adminOverrideStatus, assignAgents, transitionOrder } from '@/lib/repo/transitionOrder'
import { deleteOrder, findById } from '@/lib/repo/orderRepo'
import {
  adminAddOrderItem,
  adminEditOrder,
  adminEditOrderItem,
  adminRemoveOrderItem,
  type FieldChange,
} from '@/lib/repo/adminEditOrder'
import { ORDER_EDIT_FIELDS, type ItemEditKey } from '@/lib/orderEditFields'
import { forceRefreshTrainStatus } from '@/lib/train/service'
import {
  assertPrintAgentConfigured,
  enqueueOrderKotPrint,
  getAppOrigin,
} from '@/lib/printer/queue'
import { normalizeCustomStatus, type OrderStatus } from '@/lib/orderStatus'
import { statusLabel } from '@/components/ui'
import type { RefreshTrainState } from '@/components/RefreshTrainButton'

export type ActionState = { error?: string; ok?: string }

/**
 * "Check now" for the train behind one order — see RefreshTrainButton. Any
 * order riding the same train shares this cache row, so one click updates
 * every board and detail view showing it, not just this order's.
 */
export async function forceRefreshOrderTrain(
  _prev: RefreshTrainState,
  formData: FormData,
): Promise<RefreshTrainState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const order = await findById(ctx, orderId)
  if (!order) return { error: 'Order not found' }

  const row = await forceRefreshTrainStatus(order)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath('/store')
  if (!row) return { error: 'This order has no train.' }
  if (row.lastError) return { error: row.lastError }
  return { ok: 'Refreshed' }
}

export async function assignAgentsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const agentIds = formData.getAll('agentIds').map(String).filter(Boolean)

  try {
    await assignAgents({ ctx, orderId, agentIds })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not assign agents.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/agent')
  return { ok: agentIds.length ? 'Agents assigned.' : 'Agents cleared.' }
}

/**
 * An admin moving an order along the pipeline — including, when the kitchen
 * cannot, printing its KOT.
 *
 * KOT_PRINTED is the one edge in the machine that carries a side effect: the
 * store board's generateKot() queues a print alongside the transition. This
 * generic path had no equivalent, so "Send KOT to kitchen" marked an order
 * printed and sent nothing — leaving no PrintJob row to notice it by, and
 * hiding the kitchen's own print button (it only shows while an order is
 * still ACCEPTED). Printing here is the whole point of the button's label.
 *
 * No delay guard, unlike the store's path: an admin reaching for this is
 * already handling an exception — usually a manager on the phone saying the
 * ticket never came out — and does not need to be asked whether they meant it.
 */
export async function adminTransitionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const to = String(formData.get('to') ?? '') as OrderStatus

  // Read before the write: the print needs the outlet, and the transition
  // itself does not hand it back in a form this needs.
  const order = to === 'KOT_PRINTED' ? await findById(ctx, orderId) : null

  try {
    await transitionOrder({ ctx, orderId, to, meta: { via: 'admin-detail' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the order.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/orders')
  revalidatePath('/admin')
  revalidatePath('/store')

  if (to === 'KOT_PRINTED') {
    // `ok` is set on every return below, including the failures: the status
    // change has already committed, and the slide-over refreshes itself off
    // `ok` alone. Dropping it would leave the panel showing the old status
    // next to an error about the print. FormNote renders `error` in
    // preference to `ok`, so what the admin reads is still the problem.
    if (!order) {
      return { ok: 'Moved to KOT printed.', error: 'Moved to KOT printed, but the order vanished.' }
    }
    try {
      assertPrintAgentConfigured()
      // Routed by station, and every order has one — an order whose outlet
      // matching failed used to be unprintable and now is not.
      await enqueueOrderKotPrint({
        appOrigin: await getAppOrigin(),
        stationCode: order.stationCode,
        restaurantId: order.restaurantId,
        orderId,
      })
    } catch (err) {
      // Reported, not swallowed. The store board's equivalent logs and moves
      // on because a printer fault must not stall a kitchen mid-service; an
      // admin pressing this is already chasing a print that did not happen,
      // and a second silent failure is the worst possible answer.
      console.error(`[adminTransitionAction] KOT print enqueue failed for order ${orderId}:`, err)
      return {
        ok: 'Moved to KOT printed.',
        error: `Moved to KOT printed, but the print could not be queued: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      }
    }
    return { ok: 'KOT sent to the kitchen printer.' }
  }

  return { ok: `Order moved to ${to.replace('_', ' ')}.` }
}

/** Permanent. Redirects back to the list since the detail page it ran from is gone. */
export async function deleteOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  let ok: boolean
  try {
    ok = await deleteOrder(ctx, orderId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete the order.' }
  }
  if (!ok) return { error: 'Order not found.' }

  revalidatePath('/admin/orders')
  revalidatePath('/store')
  redirect('/admin/orders')
}

/** Every page that shows an order's details, so an edit shows everywhere at once. */
function revalidateOrder(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath(`/calls/orders/${orderId}`)
  revalidatePath('/admin/orders')
  revalidatePath('/admin')
  revalidatePath('/store')
  revalidatePath('/calls')
}

function failed(err: unknown, fallback: string): ActionState {
  return { error: err instanceof Error ? err.message : fallback }
}

function savedNote(changes: FieldChange[], what = 'Saved'): ActionState {
  if (changes.length === 0) return { ok: 'Nothing changed.' }
  return { ok: `${what}: ${changes.map((c) => c.label.toLowerCase()).join(', ')}.` }
}

/**
 * The item form's fields. The packing box is a checkbox, which a browser
 * leaves out of the form entirely when it is unticked, so the form sends a
 * marker saying the box was there to be read.
 */
function itemInput(formData: FormData): Partial<Record<ItemEditKey, string>> {
  const input: Partial<Record<ItemEditKey, string>> = {}
  for (const key of ['name', 'qty', 'pricePaise', 'notes', 'spec'] as const) {
    if (formData.has(key)) input[key] = String(formData.get(key) ?? '')
  }
  if (formData.has('hasIsPacking')) input.isPacking = formData.get('isPacking') ? 'true' : 'false'
  return input
}

/**
 * Saves the "Edit details" form. Only fields the admin actually changed are
 * sent on: each input carries the value it was opened with (`orig.<key>`),
 * so a field someone else corrected while this form sat open is not quietly
 * put back. Each change is logged as its own event.
 */
export async function editOrderDetailsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  const input: Record<string, string> = {}
  for (const f of ORDER_EDIT_FIELDS) {
    if (!formData.has(f.key)) continue
    const value = String(formData.get(f.key) ?? '')
    const orig = String(formData.get(`orig.${f.key}`) ?? '')
    if (value.trim() !== orig.trim()) input[f.key] = value
  }

  let changes: FieldChange[]
  try {
    changes = await adminEditOrder(ctx, orderId, input)
  } catch (err) {
    return failed(err, 'Could not save the order.')
  }
  revalidateOrder(orderId)
  return savedNote(changes)
}

export async function updateOrderItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const itemId = String(formData.get('itemId') ?? '')

  let changes: FieldChange[]
  try {
    changes = await adminEditOrderItem(ctx, orderId, itemId, itemInput(formData))
  } catch (err) {
    return failed(err, 'Could not save the item.')
  }
  revalidateOrder(orderId)
  return savedNote(changes, 'Item updated')
}

export async function addOrderItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  try {
    await adminAddOrderItem(ctx, orderId, itemInput(formData))
  } catch (err) {
    return failed(err, 'Could not add the item.')
  }
  revalidateOrder(orderId)
  return { ok: 'Item added.' }
}

export async function removeOrderItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const itemId = String(formData.get('itemId') ?? '')

  try {
    await adminRemoveOrderItem(ctx, orderId, itemId)
  } catch (err) {
    return failed(err, 'Could not remove the item.')
  }
  revalidateOrder(orderId)
  return { ok: 'Item removed.' }
}

export async function updateOrderRemarkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  try {
    await adminEditOrder(ctx, orderId, { remark: String(formData.get('remark') ?? '') })
  } catch (err) {
    return failed(err, 'Could not save the remark.')
  }
  revalidateOrder(orderId)
  return { ok: 'Remark saved.' }
}

/**
 * Admin-only correction of how an order is paid. Ingest guesses the mode from
 * the aggregator's mail and sometimes gets it wrong; the KOT and the store
 * board both read it, so fixing it here fixes them too. An empty value clears
 * it back to "unknown".
 */
export async function updateOrderPaymentModeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  try {
    await adminEditOrder(ctx, orderId, { paymentMode: String(formData.get('paymentMode') ?? '') })
  } catch (err) {
    return failed(err, 'Could not save the payment mode.')
  }
  revalidateOrder(orderId)
  return { ok: 'Payment mode saved.' }
}

/**
 * Sets any status, including one off the pipeline, from the order's own page.
 * The same escape hatch as the orders list's status cell (adminOverrideStatus),
 * which logs the move like any transition.
 */
export async function overrideStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const to = normalizeCustomStatus(String(formData.get('to') ?? ''))
  if (!to) return { error: 'Enter a status.' }

  try {
    await adminOverrideStatus({ ctx, orderId, to, meta: { via: 'admin-detail' } })
  } catch (err) {
    return failed(err, 'Could not set the status.')
  }
  revalidateOrder(orderId)
  revalidatePath('/agent')
  return { ok: `Status set to ${statusLabel(to)}.` }
}
