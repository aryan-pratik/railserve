'use server'

import type { Types } from 'mongoose'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'
import { ingestEmail, PARSERS, createOrderFromParsed } from '@/lib/ingest'
import { PAYMENT_PARSERS, recordPayment } from '@/lib/ingest/payments'
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
    revalidatePath('/admin/payments')
    revalidatePath('/store')
    revalidatePath('/store/payments')

    if (r.status === 'CREATED') return { ok: `Created order ${r.externalOrderId}.` }
    if (r.status === 'DUPLICATE') return { ok: `Order ${r.externalOrderId} already exists — ignored.` }
    if (r.status === 'PAYMENT') return { ok: `Recorded payment ${r.rrn} — see Payments.` }
    if (r.status === 'PAYMENT_DUPLICATE') {
      return { ok: `Payment ${r.rrn} is already recorded — ignored.` }
    }
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

  // A bank alert that landed here means the template changed and the payment
  // was never recorded. Correcting it must produce the payment, not fail with
  // "no parser recognises this" — the same fix path, for the same reason.
  const paymentParser = PAYMENT_PARSERS.find((p) => p.matches(correctedBody))
  if (paymentParser) {
    return resolveAsPayment(paymentParser, correctedBody, receivedAt, id, ctx.userId)
  }

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

  return {
    ok:
      created.status === 'CREATED'
        ? `Resolved — created order ${created.externalOrderId}.`
        : `Resolved — order ${created.externalOrderId} already existed.`,
  }
}

/**
 * The payment half of resolveUnparsed: record the credit and close the row.
 *
 * `resolvedOrderId` stays null — a payment is not an order, and pointing that
 * field at one would break every link that reads it as an order id.
 */
async function resolveAsPayment(
  parser: (typeof PAYMENT_PARSERS)[number],
  correctedBody: string,
  receivedAt: Date,
  inboxId: string,
  userId: Types.ObjectId,
): Promise<InboxState> {
  const parsed = parser.parse(correctedBody, receivedAt)
  if (!parsed.ok) return { error: `Still not parseable: ${parsed.detail}` }

  const recorded = await recordPayment(
    parsed.payment,
    { body: correctedBody, resolvedFromInbox: inboxId, receivedAt },
    null,
    receivedAt,
  )

  await UnparsedInbox.updateOne(
    { _id: inboxId },
    { $set: { resolved: true, resolvedAt: new Date(), resolvedById: userId } },
  )

  revalidatePath('/admin/inbox')
  revalidatePath('/admin/payments')
  revalidatePath('/store/payments')

  return {
    ok:
      recorded.status === 'CREATED'
        ? `Resolved — recorded payment ${recorded.rrn}.`
        : `Resolved — payment ${recorded.rrn} already existed.`,
  }
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
