import { connectDb } from '../db'
import { UnparsedInbox } from '../models'
import { insertOrder } from '../repo/orderRepo'
import { serviceDateFor } from './parsers/shared'
import { YatriRestroParser } from './parsers/yatriRestro'
import { YatriRestroBookingParser } from './parsers/yatriRestroBooking'
import { DailyYatriParser } from './parsers/dailyYatri'
import { OlfParser } from './parsers/olf'
import { YatribhojanParser } from './parsers/yatribhojan'
import { RajBhogParser } from './parsers/rajbhog'
import { ZoopParser } from './parsers/zoop'
import { matchOutlet } from './outletMatch'
import { warmTrainStatus } from '../train/service'
import type { OrderParser, ParsedOrder } from './types'

export const PARSERS: OrderParser[] = [
  new YatriRestroParser(),
  new YatriRestroBookingParser(),
  new DailyYatriParser(),
  new OlfParser(),
  new YatribhojanParser(),
  new RajBhogParser(),
  new ZoopParser(),
]

export type IngestSource = {
  body: string
  receivedAt: Date
  gmailMessageId?: string | null
  subject?: string | null
  from?: string | null
}

export type IngestOutcome =
  | { status: 'CREATED'; orderId: string; externalOrderId: string }
  | { status: 'DUPLICATE'; externalOrderId: string }
  | { status: 'UNPARSED'; inboxId: string; reason: string; detail: string }

/**
 * Turns a raw email into an order, or into an unparsed-inbox row. Never
 * anything in between — plan §6: "Any required field null -> unparsedinbox.
 * Never insert a partial order."
 *
 * Idempotent by construction. The unique indexes on externalOrderId and
 * gmailMessageId are the real guarantee; a duplicate-key error (11000) is
 * treated as a no-op success rather than an error, because Gmail's history
 * sync will replay the same message and that is normal, not exceptional
 * (§6, §13.7).
 */
export async function ingestEmail(input: IngestSource): Promise<IngestOutcome> {
  await connectDb()

  const rawPayload = {
    body: input.body,
    subject: input.subject ?? null,
    from: input.from ?? null,
    receivedAt: input.receivedAt,
  }

  const parser = PARSERS.find((p) => p.matches(input.body))

  if (!parser) {
    return recordUnparsed({
      source: 'UNKNOWN',
      rawPayload,
      reason: 'PARSE_FAILED',
      detail: 'no parser recognised this email',
      gmailMessageId: input.gmailMessageId ?? null,
    })
  }

  const result = parser.parse(input.body, input.receivedAt)

  if (!result.ok) {
    return recordUnparsed({
      source: parser.source,
      rawPayload,
      reason: result.reason,
      detail: result.detail,
      partial: result.partial ?? null,
      externalOrderId: result.partial?.externalOrderId ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
    })
  }

  const parsed = result.order

  // Never fuzzy-match an outlet into a live order (§6, §13.11).
  const outlet = await matchOutlet(parsed.outletName, parsed.stationCode)
  if (!outlet.ok) {
    return recordUnparsed({
      source: parser.source,
      rawPayload,
      reason: 'UNKNOWN_OUTLET',
      detail: outlet.detail,
      partial: parsed,
      externalOrderId: parsed.externalOrderId,
      gmailMessageId: input.gmailMessageId ?? null,
    })
  }

  return createOrderFromParsed(parsed, outlet.restaurantId, rawPayload, input.gmailMessageId ?? null)
}

/** Shared by ingestion and by resolving an unparsed row. */
export async function createOrderFromParsed(
  parsed: ParsedOrder,
  restaurantId: string,
  rawPayload: unknown,
  gmailMessageId: string | null,
): Promise<IngestOutcome> {
  const serviceDate = serviceDateFor(parsed.scheduledArrival ?? new Date())

  try {
    const doc = await insertOrder({
      source: parsed.source,
      orderType: 'RETAIL',
      externalOrderId: parsed.externalOrderId,
      status: 'RECEIVED',

      restaurantId,
      stationCode: parsed.stationCode,

      trainNo: parsed.trainNo,
      trainName: parsed.trainName,
      serviceDate,
      scheduledArrival: parsed.scheduledArrival,
      timingSource: 'SCHEDULED',

      coach: parsed.coach,
      berth: parsed.berth,
      rawSeat: parsed.rawSeat,

      contactName: parsed.contactName,
      contactPhone: parsed.contactPhone,

      amountPaise: parsed.amountPaise,
      paymentMode: parsed.paymentMode,

      items: parsed.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        pricePaise: null,
        spec: null,
        isPacking: false,
        notes: i.notes,
      })),

      events: [
        {
          fromStatus: null,
          toStatus: 'RECEIVED',
          userId: null,
          meta: { action: 'CREATED', source: parsed.source },
          createdAt: new Date(),
        },
      ],
      delivery: { agentIds: [] },
      // Plan §6: store the full raw body before parsing anything. This is the
      // record of what actually arrived when a dispute happens.
      rawPayload,
      // Omitted entirely when absent — the unique index is partial on strings.
      ...(gmailMessageId ? { gmailMessageId } : {}),
      createdById: null,
    })

    // Find out where the train actually is now, rather than showing a
    // timetable time until the next polling tick comes round. Never throws.
    await warmTrainStatus({
      trainNo: parsed.trainNo,
      serviceDate,
      stationCode: parsed.stationCode,
      scheduledArrival: parsed.scheduledArrival,
    })

    return {
      status: 'CREATED',
      orderId: String(doc._id),
      externalOrderId: parsed.externalOrderId,
    }
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return { status: 'DUPLICATE', externalOrderId: parsed.externalOrderId }
    }
    throw err
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}

async function recordUnparsed(input: {
  source: string
  rawPayload: unknown
  reason: 'UNKNOWN_OUTLET' | 'MISSING_FIELD' | 'PARSE_FAILED'
  detail: string
  partial?: unknown
  externalOrderId?: string | null
  gmailMessageId?: string | null
}): Promise<IngestOutcome> {
  // Re-processing the same message must not pile up duplicate inbox rows.
  if (input.gmailMessageId) {
    const existing = await UnparsedInbox.findOne({
      gmailMessageId: input.gmailMessageId,
      resolved: false,
    })
      .select('_id')
      .lean()
    if (existing) {
      return {
        status: 'UNPARSED',
        inboxId: String(existing._id),
        reason: input.reason,
        detail: input.detail,
      }
    }
  }

  const doc = await UnparsedInbox.create({
    source: input.source,
    rawPayload: input.rawPayload,
    reason: input.reason,
    detail: input.detail,
    partial: input.partial ?? null,
    externalOrderId: input.externalOrderId ?? null,
    ...(input.gmailMessageId ? { gmailMessageId: input.gmailMessageId } : {}),
  })

  return {
    status: 'UNPARSED',
    inboxId: String(doc._id),
    reason: input.reason,
    detail: input.detail,
  }
}
