'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { getProofStore, isAllowedContentType, ProofStoreUnavailable } from '@/lib/storage'
import { dispatchRun } from '@/lib/repo/runRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { rupeesToPaise } from '@/lib/format'

export type AgentActionState = { error?: string; ok?: string }

/**
 * Hands the browser a short-lived URL to PUT a delivery photo to the bucket.
 *
 * The mobile app gets the same thing from /api/mobile/proof-url with a bearer
 * token; the web console has a session cookie instead, so it comes through a
 * server action. Both paths share one ProofStore and one scoped lookup — the
 * order is fetched through the repository first, so a URL is only ever issued
 * for an order this rider can actually see.
 */
export async function requestProofUpload(
  orderId: string,
  contentType: string,
): Promise<{ uploadUrl: string; key: string } | { error: string }> {
  const ctx = await requireRole('DELIVERY_AGENT')

  if (!isAllowedContentType(contentType)) {
    return { error: 'Only JPEG, PNG or WebP images.' }
  }
  const order = await findById(ctx, orderId)
  if (!order) return { error: 'Order not found.' }

  try {
    const { uploadUrl, key } = await getProofStore().presignUpload({ orderId, contentType })
    return { uploadUrl, key }
  } catch (err) {
    if (err instanceof ProofStoreUnavailable) return { error: err.message }
    console.error('[requestProofUpload]', err)
    return { error: 'Could not prepare the upload.' }
  }
}

export async function dispatchRunAction(
  _prev: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const ctx = await requireRole('DELIVERY_AGENT')
  const runKey = String(formData.get('runKey') ?? '')

  try {
    const r = await dispatchRun(ctx, runKey)
    revalidatePath('/agent')
    revalidatePath(`/agent/runs/${encodeURIComponent(runKey)}`)

    if (r.errors.length) return { error: r.errors.join('; ') }
    if (r.moved === 0) {
      return { error: 'Nothing on this run is prepared yet — check with the kitchen.' }
    }
    return {
      ok:
        `Dispatched ${r.moved} order${r.moved === 1 ? '' : 's'}` +
        (r.skipped ? `, ${r.skipped} not ready yet` : '') + '.',
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not dispatch the run.' }
  }
}

export async function deliverOrderAction(
  _prev: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const ctx = await requireRole('DELIVERY_AGENT')
  const orderId = String(formData.get('orderId') ?? '')
  const receivedBy = String(formData.get('receivedBy') ?? '').trim()
  const collected = String(formData.get('amountCollected') ?? '').trim()
  // Set by the client after it has PUT the image to the bucket. Optional: a
  // rider with no signal or a dead camera must still be able to close an order.
  const proofKey = String(formData.get('proofKey') ?? '').trim()

  if (!receivedBy && !proofKey) {
    return { error: 'Add a photo, or record who received the order.' }
  }

  try {
    await transitionOrder({
      ctx,
      orderId,
      to: 'DELIVERED',
      meta: { via: 'agent-order' },
      apply: {
        // A photo is stronger evidence than a name typed at the door, so it
        // wins when both are present. proofValue holds the object key, never a
        // URL — presigned URLs expire, and a stored one would rot.
        ...(proofKey
          ? { proofType: 'PHOTO' as const, proofValue: proofKey }
          : { proofType: 'SIGNATURE' as const, proofValue: receivedBy }),
        ...(collected ? { amountCollectedPaise: rupeesToPaise(collected) ?? undefined } : {}),
      },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark delivered.' }
  }

  revalidatePath('/agent')
  revalidatePath(`/agent/orders/${orderId}`)
  return { ok: 'Delivered.' }
}

export async function failOrderAction(
  _prev: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const ctx = await requireRole('DELIVERY_AGENT')
  const orderId = String(formData.get('orderId') ?? '')
  const reason = String(formData.get('failureReason') ?? '').trim()

  if (!reason) return { error: 'Give a reason so the office can follow up.' }

  try {
    await transitionOrder({
      ctx, orderId, to: 'FAILED',
      meta: { via: 'agent-order' },
      apply: { failureReason: reason },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark failed.' }
  }

  revalidatePath('/agent')
  revalidatePath(`/agent/orders/${orderId}`)
  return { ok: 'Marked failed.' }
}

/**
 * A rider takes one order off the shelf.
 *
 * The run-level button covers the normal case — a whole train in one trip — but
 * an order can be ready before the rest of its train, and a rider who has it in
 * hand should be able to say so without waiting for the others to be cooked.
 * transitionOrder records them as the carrier automatically.
 */
export async function takeOrderAction(
  _prev: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const ctx = await requireRole('DELIVERY_AGENT')
  const orderId = String(formData.get('orderId') ?? '')

  try {
    await transitionOrder({
      ctx,
      orderId,
      to: 'DISPATCHED',
      meta: { via: 'agent-order' },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not take this order.' }
  }

  revalidatePath('/agent')
  revalidatePath(`/agent/orders/${orderId}`)
  revalidatePath('/store')
  return { ok: 'You have it.' }
}
