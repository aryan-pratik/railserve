import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { connectDb } from '../db'
import { UnparsedInbox } from '../models'
import { ForbiddenError, type AuthContext } from '../authContext'
import { findMany } from './orderRepo'
import { PARSERS, createOrderFromParsed } from '../ingest'
import { toParseableText } from '../ingest/gmail/client'
import { PAYMENT_PARSERS, recordPayment } from '../ingest/payments'
import { matchOutlet } from '../ingest/outletMatch'
import { BULK_REINGEST_LIMIT, inboxQuery, type InboxFilter } from '../inbox'

/**
 * Closing rows in the unparsed inbox: one at a time from a row's own buttons,
 * or many at once from the bulk bar.
 *
 * Every write here records who closed the row, how (`resolution`), and — for
 * a bulk action — which click it was part of and how many rows that click
 * touched, so the Resolved tab can always answer "who dismissed this, and was
 * it on purpose?" and a bulk dismiss can be undone as the batch it was.
 */

export type InboxResult = { ok?: string; error?: string }

/** The rows a bulk action applies to: the ticked ones, or every row matching the filters. */
export type InboxTarget = { ids: string[] } | { filter: InboxFilter }

export type BulkResult = {
  /** Rows the action changed. */
  count: number
  /** The batch id, for undo. Null when nothing changed. */
  bulkActionId: string | null
}

export type BulkReingestResult = {
  resolved: number
  failed: number
  /** Matching rows not attempted because the click hit BULK_REINGEST_LIMIT. */
  remaining: number
  /** The first few failure reasons, for the note under the bar. */
  errors: string[]
  bulkActionId: string | null
}

function assertAdmin(ctx: AuthContext) {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may work the inbox.')
}

function validIds(ids: string[]): mongoose.Types.ObjectId[] {
  return [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id))
}

/** The Mongo filter a target names, narrowed to `resolved`. */
function targetQuery(target: InboxTarget, resolved: boolean): Record<string, unknown> {
  if ('ids' in target) return { _id: { $in: validIds(target.ids) }, resolved }
  // The tab is part of the filter the screen showed; the action decides which
  // tab it can act on, not the form.
  return inboxQuery({ ...target.filter, resolved })
}

/** Dismiss rows that are not orders at all: newsletters, bounces, OTPs. */
export async function dismissInboxRows(ctx: AuthContext, target: InboxTarget): Promise<BulkResult> {
  assertAdmin(ctx)
  await connectDb()
  const query = targetQuery(target, false)
  if ('ids' in target && (query._id as { $in: unknown[] }).$in.length === 0) return { count: 0, bulkActionId: null }

  // Counted first so every row in the batch carries the batch's size. A row
  // that another admin closes in between is left out of the update by the
  // `resolved: false` guard; the count is then one high, which only the
  // "N dismissed together" label would show.
  const expected = await UnparsedInbox.countDocuments(query)
  if (expected === 0) return { count: 0, bulkActionId: null }

  // Always a batch id, even for one row, so the toast's Undo works the same
  // for one click on a row as for one click on the bulk bar.
  const bulkActionId = randomUUID()
  const res = await UnparsedInbox.updateMany(query, {
    $set: {
      resolved: true,
      resolvedAt: new Date(),
      resolvedById: ctx.userId,
      resolution: 'DISMISSED',
      bulkActionId,
      bulkActionCount: expected,
    },
  })
  return { count: res.modifiedCount, bulkActionId: res.modifiedCount > 0 ? bulkActionId : null }
}

/**
 * Put dismissed rows back in Needs attention. Only rows that were dismissed:
 * a row that became an order or a payment stays closed, because reopening it
 * would invite a second order for the same email.
 */
export async function reopenInboxRows(
  ctx: AuthContext,
  target: InboxTarget | { bulkActionId: string },
): Promise<number> {
  assertAdmin(ctx)
  await connectDb()
  const base =
    'bulkActionId' in target
      ? { bulkActionId: target.bulkActionId, resolved: true }
      : targetQuery(target, true)
  const res = await UnparsedInbox.updateMany(
    { $and: [base, { resolution: 'DISMISSED' }] },
    {
      $set: {
        resolved: false,
        resolvedAt: null,
        resolvedById: null,
        resolution: null,
        bulkActionId: null,
        bulkActionCount: null,
      },
    },
  )
  return res.modifiedCount
}

/**
 * Re-run rows through the parsers as they are — for after a parser is fixed
 * or an outlet alias added, when hundreds of rows that failed for one reason
 * now go through. Rows that still fail stay open, untouched.
 *
 * Sequential, and bounded per click: each row can create an order, and an
 * order write is not something to fan out two hundred wide.
 */
export async function reingestInboxRows(ctx: AuthContext, target: InboxTarget): Promise<BulkReingestResult> {
  assertAdmin(ctx)
  await connectDb()
  const query = targetQuery(target, false)
  const total = await UnparsedInbox.countDocuments(query)
  // Oldest first: the order that has been waiting longest is the most urgent.
  const rows = await UnparsedInbox.find(query)
    .sort({ createdAt: 1 })
    .limit(BULK_REINGEST_LIMIT)
    .select('_id rawPayload')
    .lean()

  const bulkActionId = rows.length > 1 ? randomUUID() : null
  let resolved = 0
  let failed = 0
  const errors: string[] = []
  for (const row of rows) {
    const body = (row.rawPayload as { body?: string } | null)?.body ?? ''
    const r = await reingestInboxRow(ctx, String(row._id), body, bulkActionId)
    if (r.ok) resolved++
    else {
      failed++
      if (r.error && errors.length < 3 && !errors.includes(r.error)) errors.push(r.error)
    }
  }
  if (bulkActionId && resolved > 0) {
    await UnparsedInbox.updateMany({ bulkActionId }, { $set: { bulkActionCount: resolved } })
  }
  return {
    resolved,
    failed,
    remaining: Math.max(0, total - rows.length),
    errors,
    bulkActionId: resolved > 0 ? bulkActionId : null,
  }
}

/**
 * Resolve one row by re-ingesting a body — the admin's correction, or the
 * stored body as it is (plan §10).
 *
 * The body goes through the same parser as a real email, so a fix here is a
 * fix to real data, not a hand-built order that skipped every check.
 */
export async function reingestInboxRow(
  ctx: AuthContext,
  id: string,
  correctedBody: string,
  bulkActionId: string | null = null,
): Promise<InboxResult> {
  assertAdmin(ctx)
  await connectDb()
  if (!mongoose.isValidObjectId(id)) return { error: 'That inbox row no longer exists.' }
  const row = await UnparsedInbox.findById(id)
  if (!row) return { error: 'That inbox row no longer exists.' }
  if (!correctedBody.trim()) return { error: 'The corrected email body cannot be empty.' }

  const receivedAt =
    (row.rawPayload as { receivedAt?: Date })?.receivedAt instanceof Date
      ? (row.rawPayload as { receivedAt: Date }).receivedAt
      : new Date()

  // A bank alert that landed here means the template changed and the payment
  // was never recorded. Correcting it must produce the payment, not fail with
  // "no parser recognises this" — the same fix path, for the same reason.
  // The stored body of a row that failed on markup IS that markup, so the
  // parsers get text; the raw payload below keeps what the admin submitted.
  const text = toParseableText(correctedBody)
  const closed = { resolved: true, resolvedAt: new Date(), resolvedById: ctx.userId, bulkActionId }

  const paymentParser = PAYMENT_PARSERS.find((p) => p.matches(text))
  if (paymentParser) {
    const parsed = paymentParser.parse(text, receivedAt)
    if (!parsed.ok) return { error: `Still not parseable: ${parsed.detail}` }
    const recorded = await recordPayment(
      parsed.payment,
      { body: correctedBody, resolvedFromInbox: id, receivedAt },
      null,
      receivedAt,
    )
    // resolvedOrderId stays null: a payment is not an order, and pointing that
    // field at one would break every link that reads it as an order id.
    await UnparsedInbox.updateOne({ _id: id }, { $set: { ...closed, resolution: 'PAYMENT' } })
    return {
      ok:
        recorded.status === 'CREATED'
          ? `Resolved: recorded payment ${recorded.rrn}.`
          : `Resolved: payment ${recorded.rrn} already existed.`,
    }
  }

  const parser = PARSERS.find((p) => p.matches(text))
  if (!parser) return { error: 'No parser recognises this email.' }

  const parsed = parser.parse(text, receivedAt)
  if (!parsed.ok) return { error: `Still not parseable: ${parsed.detail}` }

  const outlet = await matchOutlet(parsed.order.outletName, parsed.order.stationCode, parsed.order.source)
  if (!outlet.ok) {
    return { error: `Outlet still unresolved: ${outlet.detail}. Add it, or add an alias, under Outlets.` }
  }

  const created = await createOrderFromParsed(
    parsed.order,
    outlet,
    { body: correctedBody, resolvedFromInbox: id, receivedAt },
    null,
  )

  // An order that already exists — recovered some other way, or entered by
  // hand — is still the order this row was about, so the row points at it
  // rather than closing with no link. externalOrderId is unique across orders.
  const orderId =
    created.status === 'CREATED'
      ? created.orderId
      : (await findMany(ctx, { externalOrderId: created.externalOrderId }, { limit: 1 }))[0]?._id ?? null

  await UnparsedInbox.updateOne(
    { _id: id },
    { $set: { ...closed, resolution: 'ORDER', resolvedOrderId: orderId } },
  )

  return {
    ok:
      created.status === 'CREATED'
        ? `Resolved: created order ${created.externalOrderId}.`
        : `Resolved: order ${created.externalOrderId} already existed.`,
  }
}
