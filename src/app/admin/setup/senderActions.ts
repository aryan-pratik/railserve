'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { GMAIL_STATE_ID, IngestState } from '@/lib/models'
import { normaliseSenderEntry } from '@/lib/ingest/senders'

/**
 * Setup → Aggregators: the mail senders whose email is parsed as orders.
 * See lib/ingest/senders.ts for what the list does and why empty means "all".
 */

export type SenderState = { error?: string; ok?: string }

export async function addAllowedSender(_prev: SenderState, formData: FormData): Promise<SenderState> {
  await requireRole('ADMIN')
  const raw = String(formData.get('sender') ?? '')
  const entry = normaliseSenderEntry(raw)
  if (!entry) {
    return { error: 'Enter an email address like orders@zoop.in, or a whole domain like @zoop.in.' }
  }

  await connectDb()
  // Upserted: the Gmail state row may not exist yet on a fresh install, and
  // the list should be settable before the first sync ever runs.
  await IngestState.updateOne(
    { _id: GMAIL_STATE_ID },
    { $addToSet: { allowedSenders: entry } },
    { upsert: true },
  )
  revalidatePath('/admin/setup')
  return { ok: `Mail from ${entry} will be parsed.` }
}

export async function removeAllowedSender(formData: FormData): Promise<void> {
  await requireRole('ADMIN')
  const entry = normaliseSenderEntry(String(formData.get('sender') ?? ''))
  if (!entry) return
  await connectDb()
  await IngestState.updateOne({ _id: GMAIL_STATE_ID }, { $pull: { allowedSenders: entry } })
  revalidatePath('/admin/setup')
}
