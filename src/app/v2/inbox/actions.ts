'use server'

import { revalidatePath } from 'next/cache'
import {
  dismissInbox as dismissV1,
  ingestPastedEmail as ingestPastedV1,
  loadInboxBody as loadBodyV1,
  reingestInbox as reingestV1,
  reopenInbox as reopenV1,
  resolveUnparsed as resolveV1,
  type BulkInput,
  type BulkState,
  type InboxState,
} from '@/app/admin/inbox/actions'

export type { BulkInput, BulkState, InboxState }

export async function loadInboxBody(id: string): Promise<{ body: string; text: string } | null> {
  return loadBodyV1(id)
}

/**
 * The v1 inbox actions, re-exported with the v2 paths revalidated too. Each
 * one already checks the role, writes through inboxRepo and revalidates the
 * v1 screens; this adds the v2 inbox and the shell (its sidebar badge counts
 * open rows) so a click here refreshes what the person is looking at.
 */
function revalidateV2() {
  revalidatePath('/v2/inbox')
  revalidatePath('/v2', 'layout')
}

export async function ingestPastedEmail(prev: InboxState, formData: FormData): Promise<InboxState> {
  const r = await ingestPastedV1(prev, formData)
  revalidateV2()
  revalidatePath('/v2/payments')
  revalidatePath('/v2/orders')
  return r
}

export async function resolveUnparsed(prev: InboxState, formData: FormData): Promise<InboxState> {
  const r = await resolveV1(prev, formData)
  if (r.ok) revalidateV2()
  return r
}

export async function dismissInbox(input: BulkInput): Promise<BulkState> {
  const r = await dismissV1(input)
  revalidateV2()
  return r
}

export async function reingestInbox(input: BulkInput): Promise<BulkState> {
  const r = await reingestV1(input)
  revalidateV2()
  return r
}

export async function reopenInbox(input: BulkInput | { bulkActionId: string }): Promise<BulkState> {
  const r = await reopenV1(input)
  revalidateV2()
  return r
}
