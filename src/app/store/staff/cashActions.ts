'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { settleRiderCash } from '@/lib/repo/riderCashRepo'
import { formatRupees } from '@/lib/format'

export type CollectCashState = { error?: string; ok?: string }

/**
 * A store manager takes a rider's COD cash. The repository holds every rule;
 * this turns its answer into a sentence on the row. `orderIds` are the orders
 * the manager was shown, so what they counted is exactly what gets settled.
 */
export async function collectRiderCashAction(
  _prev: CollectCashState,
  formData: FormData,
): Promise<CollectCashState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const riderId = String(formData.get('riderId') ?? '')
  const orderIds = String(formData.get('orderIds') ?? '').split(',').filter(Boolean)

  try {
    const r = await settleRiderCash({ ctx, riderId, orderIds })
    revalidatePath('/store/staff')
    revalidatePath('/admin/riders')
    return { ok: `Collected ${formatRupees(r.paise)} for ${r.orders} order${r.orders === 1 ? '' : 's'}.` }
  } catch (err) {
    revalidatePath('/store/staff')
    return { error: err instanceof Error ? err.message : 'Could not record the handover.' }
  }
}
