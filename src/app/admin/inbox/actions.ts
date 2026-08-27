'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'
import { ingestEmail, PARSERS, createOrderFromParsed } from '@/lib/ingest'
import { matchOutlet } from '@/lib/ingest/outletMatch'

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
    const r = await ingestEmail({ body, receivedAt: new Date(), subject: 'Pasted by admin' })
    revalidatePath('/admin/inbox')
    revalidatePath('/admin/orders')
    revalidatePath('/store')

    if (r.status === 'CREATED') return { ok: `Created order ${r.externalOrderId}.` }
    if (r.status === 'DUPLICATE') return { ok: `Order ${r.externalOrderId} already exists — ignored.` }
    return { error: `Could not parse: ${r.detail}. Filed in the unparsed inbox.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Ingestion failed.' }
  }
}

/**
 * Resolve an unparsed row by correcting it and re-ingesting (plan §10).
 *
 * The admin supplies the corrected body; it goes through the same parser as a
 * real email, so a fix here is a fix to real data, not a hand-built order that
 * skipped every check.
 */
export async function resolveUnparsed(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  const ctx = await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  const correctedBody = String(formData.get('body') ?? '').trim()

  await connectDb()
  const row = await UnparsedInbox.findById(id)
  if (!row) return { error: 'That inbox row no longer exists.' }
  if (!correctedBody) return { error: 'The corrected email body cannot be empty.' }

  const receivedAt =
    (row.rawPayload as { receivedAt?: Date })?.receivedAt instanceof Date
      ? (row.rawPayload as { receivedAt: Date }).receivedAt
      : new Date()

  const parser = PARSERS.find((p) => p.matches(correctedBody))
  if (!parser) return { error: 'No parser recognises this email.' }

  const parsed = parser.parse(correctedBody, receivedAt)
  if (!parsed.ok) return { error: `Still not parseable: ${parsed.detail}` }

  const outlet = await matchOutlet(parsed.order.outletName, parsed.order.stationCode)
  if (!outlet.ok) {
    return { error: `Outlet still unresolved: ${outlet.detail}. Add it, or add an alias, under Outlets.` }
  }

  const created = await createOrderFromParsed(
    parsed.order,
    outlet.restaurantId,
    { body: correctedBody, resolvedFromInbox: id, receivedAt },
    null,
  )

  await UnparsedInbox.updateOne(
    { _id: id },
    {
      $set: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedById: ctx.userId,
        resolvedOrderId: created.status === 'CREATED' ? created.orderId : null,
      },
    },
  )

  revalidatePath('/admin/inbox')
  revalidatePath('/admin/orders')
  revalidatePath('/store')

  // createOrderFromParsed only ever returns CREATED or DUPLICATE — an
  // UNPARSED outcome cannot arise here, since parsing already succeeded.
  const label =
    created.status === 'CREATED'
      ? `Resolved — created order ${created.externalOrderId}.`
      : created.status === 'DUPLICATE'
        ? `Resolved — order ${created.externalOrderId} already existed.`
        : 'Resolved.'

  return { ok: label }
}

/** Dismiss a row that is not an order at all (a newsletter, a bounce). */
export async function dismissUnparsed(formData: FormData) {
  const ctx = await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  await connectDb()
  await UnparsedInbox.updateOne(
    { _id: id },
    { $set: { resolved: true, resolvedAt: new Date(), resolvedById: ctx.userId } },
  )
  revalidatePath('/admin/inbox')
}
