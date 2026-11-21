'use server'

import { revalidatePath } from 'next/cache'
import {
  acceptRun,
  forceRefreshOrderTrain,
  generateRunKot,
  handRunToRiderAction,
  markRunPrepared,
  type StoreActionState,
} from '@/app/store/actions'

/*
 * The kitchen board's mutations are the store board's, unchanged: same repo
 * calls, same status machine, same print queue. These only add the v2 path
 * to what gets revalidated, so the board the button sits on re-renders too.
 */

export type KitchenActionState = StoreActionState

export async function acceptRunV2(prev: KitchenActionState, formData: FormData): Promise<KitchenActionState> {
  const result = await acceptRun(prev, formData)
  revalidatePath('/v2/kitchen')
  return result
}

export async function markRunPreparedV2(prev: KitchenActionState, formData: FormData): Promise<KitchenActionState> {
  const result = await markRunPrepared(prev, formData)
  revalidatePath('/v2/kitchen')
  return result
}

export async function handRunToRiderV2(prev: KitchenActionState, formData: FormData): Promise<KitchenActionState> {
  const result = await handRunToRiderAction(prev, formData)
  revalidatePath('/v2/kitchen')
  return result
}

/**
 * Print returns nothing in v1 (the revalidation is the feedback); here it
 * reports so the footer can say "sent to the printer" and clear the ticks.
 */
export async function generateRunKotV2(_prev: KitchenActionState, formData: FormData): Promise<KitchenActionState> {
  try {
    await generateRunKot(formData)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not print the KOTs.' }
  }
  revalidatePath('/v2/kitchen')
  revalidatePath('/v2/kitchen/kot/[runKey]', 'page')
  return { ok: 'KOTs sent to the printer.' }
}

/**
 * "Check now" for one train: asks the railway for this train's position
 * immediately instead of waiting for the next polling tier. Keyed by any
 * order on the run, since the cache row is shared by every order riding it.
 */
export async function checkTrainV2(prev: KitchenActionState, formData: FormData): Promise<KitchenActionState> {
  const result = await forceRefreshOrderTrain(prev, formData)
  revalidatePath('/v2/kitchen')
  return result
}
