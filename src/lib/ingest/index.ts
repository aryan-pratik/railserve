import type { Types } from 'mongoose'
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
import { BrotherByteParser } from './parsers/brotherbyte'
import { HomeBytesParser } from './parsers/homebytes'
import { RailRestroParser } from './parsers/railrestro'
import { RelFoodParser, RelFoodWhatsAppParser } from './parsers/relfood'
import { FoodOnTrainsParser } from './parsers/foodontrains'
import { OrderNotificationParser } from './parsers/orderNotification'
import { matchOutlet } from './outletMatch'
import { isAllowedSender, senderAddress } from './senders'
import { readMailAuth, type MailAuth } from './mailAuth'
import { listsSender, loadMailSources, trustFor, type MailSourceRow } from './mailSources'
import { runTemplate, templateMatches } from './templates/engine'
import { SOURCE_LABEL, type OrderSource } from '../orderEnums'
import { PAYMENT_PARSERS, recordPayment } from './payments'
import { warmTrainStatus } from '../train/service'
import type { OrderParser, ParsedOrder, ParseResult } from './types'

export const PARSERS: OrderParser[] = [
  new YatriRestroParser(),
  new YatriRestroBookingParser(),
  new DailyYatriParser(),
  new OlfParser(),
  new YatribhojanParser(),
  new RajBhogParser(),
  new ZoopParser(),
  new BrotherByteParser(),
  new HomeBytesParser(),
  new RailRestroParser(),
  new RelFoodParser(),
  new FoodOnTrainsParser(),
  // These two match on shape alone — neither message names its vendor — so
  // they stay last, behind every parser that keys on a vendor's name.
  new OrderNotificationParser(),
  new RelFoodWhatsAppParser(),
]

export type IngestSource = {
  /**
   * The tenant the mail is for. The Gmail sync passes the primary tenant's
   * (it owns the env-configured mailbox); a paste passes the admin's own.
   */
  tenantId: Types.ObjectId
  body: string
  receivedAt: Date
  gmailMessageId?: string | null
  subject?: string | null
  from?: string | null
  /**
   * The admin's list of aggregator senders. Only the Gmail sync passes it: a
   * pasted email has no sender and is pasted on purpose, so it is always
   * parsed. Absent or empty means every sender. See ./senders.ts.
   */
  allowedSenders?: readonly string[]
  /**
   * Only the Gmail sync passes this. `enforceSenders` is the company's "only
   * known senders" switch; `authResults` is Gmail's own
   * Authentication-Results header (see ./mailAuth.ts). A pasted email has
   * neither and is parsed as before: an admin pasted it on purpose.
   */
  mailbox?: { enforceSenders: boolean; authResults: string | null }
}

/**
 * What writing a parsed order can produce. Narrower than IngestOutcome on
 * purpose: by the time an order is being written, parsing has already
 * succeeded, so neither a payment nor an unparsed row is reachable — and
 * saying so in the type saves every caller a branch it can never take.
 */
export type OrderIngestOutcome =
  | { status: 'CREATED'; orderId: string; externalOrderId: string }
  | { status: 'DUPLICATE'; externalOrderId: string }

export type IngestOutcome =
  | OrderIngestOutcome
  | { status: 'PAYMENT'; paymentId: string; rrn: string }
  | { status: 'PAYMENT_DUPLICATE'; rrn: string }
  | { status: 'UNPARSED'; inboxId: string; reason: string; detail: string }
  /** Not from a listed aggregator sender: skipped, with no inbox row. */
  | { status: 'IGNORED'; from: string | null }

/**
 * Turns a raw email into an order, a payment, or an unparsed-inbox row. Never
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

  const sender = senderAddress(input.from)
  const auth = input.mailbox ? readMailAuth(input.mailbox.authResults, sender) : null
  const rawPayload = {
    body: input.body,
    subject: input.subject ?? null,
    from: input.from ?? null,
    receivedAt: input.receivedAt,
    ...(auth ? { auth } : {}),
  }
  const enforce = input.mailbox?.enforceSenders === true
  const sources = await loadMailSources(input.tenantId)
  const unparsed = (fields: Omit<Parameters<typeof recordUnparsed>[1], 'rawPayload' | 'gmailMessageId'>) =>
    recordUnparsed(input.tenantId, { ...fields, rawPayload, gmailMessageId: input.gmailMessageId ?? null })

  // Bank credit alerts arrive in the same mailbox and are not orders. They
  // are recognised first, so they never reach the order parsers and never get
  // filed as "an order nobody is cooking".
  const paymentOutcome = await tryIngestPayment(input, rawPayload, enforce ? { sources, sender, auth } : null)
  if (paymentOutcome) return paymentOutcome

  // A layout an admin taught reads only mail from its own senders (any
  // pasted mail, which has none), so it is checked before everything else.
  const taught = findTaught(sources, input.body, input.mailbox ? { sender, auth } : null)
  if (taught) {
    const result = runTemplate(input.body, taught.rules!, (taught.source ?? 'OTHER') as OrderSource, input.receivedAt)
    return finishParsed(input, taught.source ?? 'OTHER', result, rawPayload)
  }

  if (!enforce) {
    // Checked after payments, so a bank alert never needs its sender listed,
    // and before the parsers, so mail from anyone else never becomes an inbox
    // row. A listed sender's mail that fails to parse still lands there below.
    if (!isAllowedSender(input.from, input.allowedSenders ?? [])) {
      return { status: 'IGNORED', from: sender }
    }
  }

  const parser = PARSERS.find((p) => p.matches(input.body))

  if (!parser) {
    // With "only known senders" on, mail from a stranger that looks like no
    // order is skipped without a row; from a listed sender it means their
    // layout changed, which someone needs to see.
    if (enforce && !sources.some((r) => r.active && listsSender(r.senders, sender))) {
      return { status: 'IGNORED', from: sender }
    }
    return unparsed({ source: 'UNKNOWN', reason: 'PARSE_FAILED', detail: 'no parser recognised this email' })
  }

  if (enforce) {
    const label = SOURCE_LABEL[parser.source] ?? parser.source
    const row = sources.find((r) => r.kind === 'BUILTIN' && r.key === parser.source)
    const trust = trustFor(row, label, sender, auth)
    if (!trust.ok) {
      // Read it anyway, so the waiting row shows what the order would be.
      const peek = parser.parse(input.body, input.receivedAt)
      const partial = peek.ok ? peek.order : (peek.partial ?? null)
      return unparsed({
        source: parser.source,
        reason: 'SENDER_NOT_TRUSTED',
        detail: trust.why,
        partial,
        externalOrderId: partial?.externalOrderId ?? null,
      })
    }
  }

  return finishParsed(input, parser.source, parser.parse(input.body, input.receivedAt), rawPayload)
}

/**
 * The taught layout that should read this mail, if any. From the mailbox,
 * only layouts that list the sender (and, when they ask for it, mail Gmail
 * verified); for pasted mail, any layout whose markers are in the text.
 */
function findTaught(
  sources: MailSourceRow[],
  body: string,
  mailbox: { sender: string | null; auth: MailAuth | null } | null,
): MailSourceRow | null {
  for (const row of sources) {
    if (row.kind !== 'TAUGHT' || !row.active || !row.rules) continue
    if (mailbox) {
      if (!listsSender(row.senders, mailbox.sender)) continue
      if (row.requireVerified && !mailbox.auth?.verified) continue
    }
    if (templateMatches(body, row.rules)) return row
  }
  return null
}

/** A parse result to an order, or to a waiting row that says what went wrong. */
async function finishParsed(
  input: IngestSource,
  source: string,
  result: ParseResult,
  rawPayload: unknown,
): Promise<IngestOutcome> {
  if (!result.ok) {
    return recordUnparsed(input.tenantId, {
      source,
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
  const outlet = await matchOutlet(input.tenantId, parsed.outletName, parsed.stationCode, parsed.source)
  if (!outlet.ok) {
    return recordUnparsed(input.tenantId, {
      source,
      rawPayload,
      reason: 'UNKNOWN_OUTLET',
      detail: outlet.detail,
      partial: parsed,
      externalOrderId: parsed.externalOrderId,
      gmailMessageId: input.gmailMessageId ?? null,
    })
  }

  return createOrderFromParsed(input.tenantId, parsed, outlet, rawPayload, input.gmailMessageId ?? null)
}

/**
 * Reads an email an admin is fixing by hand (re-ingesting a waiting row):
 * a taught layout first, then the built-in readers. No sender check, since
 * the admin is vouching for this one email. Null when nothing recognises it.
 */
export async function parseForAdmin(
  tenantId: Types.ObjectId,
  text: string,
  receivedAt: Date,
  from: string | null,
): Promise<{ source: string; result: ParseResult } | null> {
  const sources = await loadMailSources(tenantId)
  const sender = senderAddress(from)
  const own = sources.filter((r) => r.kind === 'TAUGHT' && listsSender(r.senders, sender))
  const taught = findTaught(own.length ? own : sources, text, null)
  if (taught) return { source: taught.source ?? 'OTHER', result: runTemplate(text, taught.rules!, (taught.source ?? 'OTHER') as OrderSource, receivedAt) }
  const parser = PARSERS.find((p) => p.matches(text))
  return parser ? { source: parser.source, result: parser.parse(text, receivedAt) } : null
}

/**
 * Records a bank alert, or returns null if this email is not one.
 *
 * A parser that matched but could not parse still lands in the unparsed inbox
 * — that IS an alert worth someone's attention, because it means the bank
 * changed its template and money is arriving that nobody is recording. What
 * the plan's safety net is for; only the successful ones are quiet.
 */
async function tryIngestPayment(
  input: IngestSource,
  rawPayload: unknown,
  check: { sources: MailSourceRow[]; sender: string | null; auth: MailAuth | null } | null,
): Promise<IngestOutcome | null> {
  const parser = PAYMENT_PARSERS.find((p) => p.matches(input.body))
  if (!parser) return null

  // A forged credit alert would put money in the ledger that never arrived,
  // so with "only known senders" on, a bank alert needs its sender listed too.
  if (check) {
    const row = check.sources.find((r) => r.kind === 'PAYMENT' && r.key === `PAY:${parser.provider}`)
    const trust = trustFor(row, `${parser.provider} bank alert`, check.sender, check.auth)
    if (!trust.ok) {
      return recordUnparsed(input.tenantId, {
        source: parser.provider,
        rawPayload,
        reason: 'SENDER_NOT_TRUSTED',
        detail: trust.why,
        gmailMessageId: input.gmailMessageId ?? null,
      })
    }
  }

  const result = parser.parse(input.body, input.receivedAt)

  if (!result.ok) {
    return recordUnparsed(input.tenantId, {
      source: parser.provider,
      rawPayload,
      reason: result.reason,
      detail: result.detail,
      partial: result.partial ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
    })
  }

  const recorded = await recordPayment(
    input.tenantId,
    result.payment,
    rawPayload,
    input.gmailMessageId ?? null,
    input.receivedAt,
  )

  return recorded.status === 'CREATED'
    ? { status: 'PAYMENT', paymentId: recorded.paymentId, rrn: recorded.rrn }
    : { status: 'PAYMENT_DUPLICATE', rrn: recorded.rrn }
}

/**
 * Shared by ingestion and by resolving an unparsed row.
 *
 * Takes the resolved outlet rather than a bare restaurantId, because the
 * outlet is also where the order's station comes from. A parser's own
 * stationCode is a claim about the email; the outlet's is a fact about the
 * kitchen, and RailRestro sends no station at all — so the outlet is the only
 * answer that exists for every source. The two agree wherever both are
 * present, since matchOutlet refuses the match outright when they disagree.
 */
export async function createOrderFromParsed(
  tenantId: Types.ObjectId,
  parsed: ParsedOrder,
  outlet: { restaurantId: string; stationCode: string },
  rawPayload: unknown,
  gmailMessageId: string | null,
): Promise<OrderIngestOutcome> {
  const serviceDate = serviceDateFor(parsed.scheduledArrival ?? new Date())

  try {
    const doc = await insertOrder({
      tenantId,
      source: parsed.source,
      orderType: 'RETAIL',
      externalOrderId: parsed.externalOrderId,
      status: 'RECEIVED',

      restaurantId: outlet.restaurantId,
      stationCode: outlet.stationCode,

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
      stationCode: outlet.stationCode,
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

async function recordUnparsed(tenantId: Types.ObjectId, input: {
  source: string
  rawPayload: unknown
  reason: 'UNKNOWN_OUTLET' | 'MISSING_FIELD' | 'PARSE_FAILED' | 'SENDER_NOT_TRUSTED'
  detail: string
  partial?: unknown
  externalOrderId?: string | null
  gmailMessageId?: string | null
}): Promise<IngestOutcome> {
  // Re-processing the same message must not pile up duplicate inbox rows.
  if (input.gmailMessageId) {
    const existing = await UnparsedInbox.findOne({
      tenantId,
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
    tenantId,
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
