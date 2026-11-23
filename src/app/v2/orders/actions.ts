'use server'

import { revalidatePath } from 'next/cache'
import { acceptRun, generateRunKot, handRunToRiderAction, markRunPrepared } from '@/app/store/actions'
import { updateOrderStatusAction, type ActionState } from '@/app/admin/orders/actions'
import { markReturnedAction, type ReturnActionState } from '@/app/actions/returns'
import { parseBulkPick, type BulkKind } from '@/lib/v2/orders'
import { markManyReturned } from '@/lib/repo/rtoRepo'
import { requireRole } from '@/lib/session'

/*
 * Thin v2 wrappers. Every mutation is still the v1 action (which is the one
 * copy of each transition); these only let one form act across several
 * trains and revalidate the v2 table as well as the v1 screens.
 */

export type BulkState = { error?: string; ok?: string }

/**
 * Accept, print KOTs, mark ready or hand to rider for the ticked orders, whichever
 * trains they are on. The run actions take one train at a time (a rider
 * carries one train's bags in one trip), so the picks are grouped by run key
 * and each run gets its own call.
 */
export async function bulkOrdersAction(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const kind = String(formData.get('kind') ?? '') as BulkKind
  const riderId = String(formData.get('riderId') ?? '')
  const byRun = new Map<string, string[]>()
  for (const raw of formData.getAll('pick')) {
    const pick = parseBulkPick(String(raw))
    if (!pick) continue
    byRun.set(pick.runKey, [...(byRun.get(pick.runKey) ?? []), pick.orderId])
  }
  if (byRun.size === 0) return { error: 'Nothing selected.' }
  if (kind === 'hand' && !riderId) return { error: 'Choose a rider first.' }

  let moved = 0
  const errors: string[] = []
  for (const [runKey, orderIds] of byRun) {
    const fd = new FormData()
    fd.set('runKey', runKey)
    for (const id of orderIds) fd.append('orderId', id)
    if (kind === 'hand') fd.set('riderId', riderId)

    if (kind === 'kot') {
      // Prints and moves ACCEPTED → KOT_PRINTED; returns nothing, so count the picks.
      await generateRunKot(fd)
      moved += orderIds.length
      continue
    }
    const result =
      kind === 'accept' ? await acceptRun({}, fd) : kind === 'ready' ? await markRunPrepared({}, fd) : await handRunToRiderAction({}, fd)
    if (result.error) errors.push(result.error)
    else moved += Number.parseInt(result.ok ?? '', 10) || orderIds.length
  }
  revalidatePath('/v2/orders')

  if (errors.length > 0 && moved === 0) return { error: errors[0] }
  const noun = `${moved} order${moved === 1 ? '' : 's'}`
  const verb = kind === 'accept' ? 'accepted' : kind === 'ready' ? 'marked ready' : kind === 'hand' ? 'on the way' : 'sent to print'
  return { ok: `${noun} ${verb}.${errors.length ? ` ${errors[0]}` : ''}` }
}

/** Admin's inline status override, then the v2 table is refreshed too. */
export async function setOrderStatusV2(prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await updateOrderStatusAction(prev, formData)
  if (result.ok) revalidatePath('/v2/orders')
  return result
}

/** The bag is back on the counter. */
export async function markReturnedV2(prev: ReturnActionState, formData: FormData): Promise<ReturnActionState> {
  const result = await markReturnedAction(prev, formData)
  if (result.ok) revalidatePath('/v2/orders')
  return result
}

/** A rider's bags back at once: every id goes through the same rules as one. */
export async function markManyReturnedV2(prev: ReturnActionState, formData: FormData): Promise<ReturnActionState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const ids = String(formData.get('orderIds') ?? '').split(',').filter(Boolean)
  const note = String(formData.get('note') ?? '').trim() || null
  if (ids.length === 0) return { error: 'Nothing picked.' }
  let r: { marked: number; errors: string[] }
  try {
    r = await markManyReturned(ctx, ids, note)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record the returns.' }
  }
  revalidatePath('/v2/orders')
  revalidatePath('/store')
  revalidatePath('/admin')
  if (r.marked === 0) return { error: r.errors[0] ?? 'None of them could be marked.' }
  return { ok: `${r.marked} bag${r.marked === 1 ? '' : 's'} marked returned.${r.errors.length ? ` Not marked: ${r.errors.join(' ')}` : ''}` }
}
