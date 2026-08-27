'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { dispatchRun } from '@/lib/repo/runRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { rupeesToPaise } from '@/lib/format'

export type AgentActionState = { error?: string; ok?: string }

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

  if (!receivedBy) {
    return { error: 'Record who received the order.' }
  }

  try {
    await transitionOrder({
      ctx,
      orderId,
      to: 'DELIVERED',
      meta: { via: 'agent-order' },
      apply: {
        // MVP proof is a name typed at the door. proofType stays on the
        // document so OTP and photo slot in later without a schema change.
        proofType: 'SIGNATURE',
        proofValue: receivedBy,
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
