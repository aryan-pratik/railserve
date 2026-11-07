'use server'

import mongoose from 'mongoose'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'
import { ingestEmail } from '@/lib/ingest'
import { toParseableText } from '@/lib/ingest/gmail/client'
import { BULK_REINGEST_LIMIT, readInboxFilter } from '@/lib/inbox'
import {
  dismissInboxRows,
  reingestInboxRow,
  reingestInboxRows,
  reopenInboxRows,
  type InboxTarget,
} from '@/lib/repo/inboxRepo'

export type InboxState = { error?: string; ok?: string }

/**
 * Manual ingestion. Plan §6's transport is Gmail → Pub/Sub → webhook, which
 * needs a Google Cloud project; this route exercises the identical pipeline
 * from a pasted body, so parsing, alias matching, idempotency and the unparsed
 * inbox are all usable and testable before any of that exists.
 */
export async function ingestPastedEmail(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  await requireRole('ADMIN')
  const body = String(formData.get('body') ?? '').trim()
  if (!body) return { error: 'Paste an email body first.' }

  try {
    // "Show original" pastes are often the raw HTML, which no parser reads.
    const r = await ingestEmail({ body: toParseableText(body), receivedAt: new Date(), subject: 'Pasted by admin' })
    revalidatePath('/admin/inbox')
    revalidatePath('/admin/orders')
    revalidatePath('/admin/payments')
    revalidatePath('/store')
    revalidatePath('/store/payments')

    if (r.status === 'CREATED') return { ok: `Created order ${r.externalOrderId}.` }
    if (r.status === 'DUPLICATE') return { ok: `Order ${r.externalOrderId} already exists: ignored.` }
    if (r.status === 'PAYMENT') return { ok: `Recorded payment ${r.rrn}: see Payments.` }
    if (r.status === 'PAYMENT_DUPLICATE') {
      return { ok: `Payment ${r.rrn} is already recorded: ignored.` }
    }
    // Unreachable for a paste, which passes no sender list; here for the type.
    if (r.status === 'IGNORED') return { error: 'Skipped: not from a listed aggregator sender.' }
    return { error: `Could not parse: ${r.detail}. Filed in the unparsed inbox.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Ingestion failed.' }
  }
}

/** Every screen a closed inbox row can change. */
function revalidateAfterInbox() {
  revalidatePath('/admin/inbox')
  revalidatePath('/admin', 'layout')
  revalidatePath('/admin/orders')
  revalidatePath('/admin/payments')
  revalidatePath('/store')
  revalidatePath('/store/payments')
}

/**
 * Resolve an unparsed row by correcting it and re-ingesting (plan §10).
 *
 * The admin supplies the corrected body; it goes through the same parser as a
 * real email. See reingestInboxRow.
 */
export async function resolveUnparsed(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  const ctx = await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  const correctedBody = String(formData.get('body') ?? '').trim()
  const result = await reingestInboxRow(ctx, id, correctedBody)
  if (result.ok) revalidateAfterInbox()
  return result
}

/** The stored body of one row, fetched when the row is opened rather than with the page. */
export async function loadInboxBody(id: string): Promise<{ body: string; text: string } | null> {
  await requireRole('ADMIN')
  if (!mongoose.isValidObjectId(id)) return null
  await connectDb()
  const row = await UnparsedInbox.findById(id).select('rawPayload').lean()
  if (!row) return null
  const body = (row.rawPayload as { body?: string } | null)?.body ?? ''
  return { body, text: toParseableText(body) }
}

export type BulkInput =
  | { ids: string[] }
  /** The page's own query string: "every row matching what I am looking at". */
  | { query: string }

function toTarget(input: BulkInput): InboxTarget {
  if ('ids' in input) return { ids: input.ids.slice(0, 500) }
  return { filter: readInboxFilter(new URLSearchParams(input.query)) }
}

export type BulkState = { ok?: string; error?: string; undo?: string | null }

/** Dismiss one row, or many, as not an order (a newsletter, a bounce). */
export async function dismissInbox(input: BulkInput): Promise<BulkState> {
  const ctx = await requireRole('ADMIN')
  try {
    const r = await dismissInboxRows(ctx, toTarget(input))
    revalidateAfterInbox()
    if (r.count === 0) return { error: 'Nothing to dismiss: those rows were already closed.' }
    return { ok: `Dismissed ${r.count} email${r.count === 1 ? '' : 's'}.`, undo: r.bulkActionId }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Dismiss failed.' }
  }
}

/** Re-run rows through the parsers as they are. */
export async function reingestInbox(input: BulkInput): Promise<BulkState> {
  const ctx = await requireRole('ADMIN')
  try {
    const r = await reingestInboxRows(ctx, toTarget(input))
    revalidateAfterInbox()
    const parts = [`Re-ingested ${r.resolved} of ${r.resolved + r.failed}.`]
    if (r.failed) parts.push(`${r.failed} still fail${r.failed === 1 ? 's' : ''}${r.errors.length ? ` (${r.errors.join('; ')})` : ''}.`)
    if (r.remaining) parts.push(`${r.remaining} more match; run it again for the next ${BULK_REINGEST_LIMIT}.`)
    return r.resolved > 0 ? { ok: parts.join(' ') } : { error: parts.join(' ') }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Re-ingest failed.' }
  }
}

/** Put dismissed rows back in Needs attention: an undo, or a change of mind. */
export async function reopenInbox(input: BulkInput | { bulkActionId: string }): Promise<BulkState> {
  const ctx = await requireRole('ADMIN')
  try {
    const n = await reopenInboxRows(ctx, 'bulkActionId' in input ? input : toTarget(input))
    revalidateAfterInbox()
    if (n === 0) return { error: 'Nothing to reopen: only dismissed rows can be reopened.' }
    return { ok: `Moved ${n} email${n === 1 ? '' : 's'} back to Needs attention.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Reopen failed.' }
  }
}
