import mongoose, { type QueryFilter } from 'mongoose'
import {
  Order,
  Restaurant,
  User,
  WaConversation,
  WaMessage,
  type OrderDoc,
  type WaConversationDoc,
  type WaMessageDoc,
} from '../models'
import { type AuthContext, ConflictError, ForbiddenError, NotFoundError } from '../authContext'
import { findByIdOrThrow } from './orderRepo'
import { normalisePhone, phoneTail } from '../whatsapp/phone'
import { sessionWindow } from '../whatsapp/session'
import { renderTemplateBody } from '../whatsapp/template'
import type { WhatsAppProvider } from '../whatsapp/provider'
import type { InboundEvent, StatusEvent } from '../whatsapp/webhook'

/**
 * THE ONLY PLACE WaConversation / WaMessage MAY BE READ OR WRITTEN.
 *
 * Same discipline as orderRepo, same reason: a telecaller at one station must
 * never see a passenger talking to another. Every read here is filtered by
 * the caller's context first; the two system entry points that take no
 * context (recordInbound, applyStatus) are the webhook's and are named for
 * it.
 */

/** The roles that may open the chat at all. */
function assertChatRole(ctx: AuthContext) {
  if (ctx.role !== 'TELECALLER' && ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only telecallers and admins can use WhatsApp chat')
  }
}

/**
 * ADMIN sees everything. A TELECALLER sees the threads of the outlets they
 * hold, plus threads no outlet has claimed — a number that wrote in with no
 * order on file is nobody's until somebody answers it, and leaving it
 * invisible to everyone would mean it is never answered.
 */
function scopeFilter(ctx: AuthContext): QueryFilter<WaConversationDoc> {
  assertChatRole(ctx)
  if (ctx.role === 'ADMIN') return {}
  if (ctx.restaurantIds.length === 0) return { _id: { $exists: false } }
  return { $or: [{ restaurantId: { $in: ctx.restaurantIds } }, { restaurantId: null }] }
}

function scoped(ctx: AuthContext, filter: QueryFilter<WaConversationDoc> = {}): QueryFilter<WaConversationDoc> {
  const scope = scopeFilter(ctx)
  if (Object.keys(scope).length === 0) return filter
  if (Object.keys(filter).length === 0) return scope
  return { $and: [scope, filter] }
}

export const WA_TEXT_MAX = 4096
export const THREAD_PAGE = 100

export type ConversationFilter = 'all' | 'unread' | 'mine' | 'unassigned'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ── reads ────────────────────────────────────────────────────────────────── */

export async function listConversations(
  ctx: AuthContext,
  opts: { q?: string; filter?: ConversationFilter; skip?: number; limit?: number } = {},
) {
  const filter: QueryFilter<WaConversationDoc> = {}
  if (opts.filter === 'unread') filter.unreadCount = { $gt: 0 }
  if (opts.filter === 'mine') filter.assignedTo = ctx.userId
  // Threads nobody has taken: the manager's queue of passengers waiting on no one.
  if (opts.filter === 'unassigned') filter.assignedTo = null
  if (opts.q) {
    const rx = { $regex: escapeRegExp(opts.q.replace(/\s+/g, '')), $options: 'i' }
    const nameRx = { $regex: escapeRegExp(opts.q), $options: 'i' }
    filter.$or = [{ phone: rx }, { customerName: nameRx }]
  }
  const query = scoped(ctx, filter)
  const [rows, total] = await Promise.all([
    WaConversation.find(query)
      // Threads with a message on top, newest first; a thread just opened
      // and not yet written to sorts by when it was opened.
      .sort({ lastMessageAt: -1, createdAt: -1, _id: -1 })
      .skip(opts.skip ?? 0)
      .limit(opts.limit ?? 20)
      .lean(),
    WaConversation.countDocuments(query),
  ])
  return { rows, total }
}

export async function findConversation(ctx: AuthContext, id: string) {
  if (!mongoose.isValidObjectId(id)) return null
  return WaConversation.findOne(scoped(ctx, { _id: new mongoose.Types.ObjectId(id) })).lean()
}

async function findConversationOrThrow(ctx: AuthContext, id: string) {
  const c = await findConversation(ctx, id)
  if (!c) throw new NotFoundError('Conversation not found')
  return c
}

/**
 * One page of a thread, oldest first as the thread renders it: the newest
 * THREAD_PAGE messages, or the THREAD_PAGE before `before` when the reader
 * scrolls up for history. `hasMore` says whether another page exists above.
 */
export async function listMessagesPage(
  ctx: AuthContext,
  conversationId: string,
  opts: { limit?: number; before?: Date | null } = {},
) {
  const c = await findConversationOrThrow(ctx, conversationId)
  const limit = Math.min(Math.max(opts.limit ?? THREAD_PAGE, 1), 200)
  const filter: QueryFilter<WaMessageDoc> = { conversationId: c._id }
  if (opts.before) filter.createdAt = { $lt: opts.before }
  // One extra row answers "is there more" without a second count query.
  const rows = await WaMessage.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean()
  const hasMore = rows.length > limit
  return { rows: rows.slice(0, limit).reverse(), hasMore }
}

/** The newest THREAD_PAGE messages, oldest first. */
export async function listMessages(ctx: AuthContext, conversationId: string, limit = THREAD_PAGE) {
  return (await listMessagesPage(ctx, conversationId, { limit })).rows
}

/** Unread inbound messages across every thread in scope, for the nav badge. */
export async function countUnread(ctx: AuthContext): Promise<number> {
  const rows = await WaConversation.aggregate<{ total: number }>([
    { $match: scoped(ctx, { unreadCount: { $gt: 0 } }) },
    { $group: { _id: null, total: { $sum: '$unreadCount' } } },
  ])
  return rows[0]?.total ?? 0
}

/**
 * Something for the live stream to compare between ticks: when anything in
 * scope last changed, and when this one thread did. A status report bumps a
 * conversation's updatedAt (see applyStatus), so a tick on a read receipt
 * is reflected too.
 */
export async function chatVersion(ctx: AuthContext, conversationId?: string | null) {
  const [latest, thread] = await Promise.all([
    WaConversation.findOne(scoped(ctx)).sort({ updatedAt: -1 }).select('updatedAt').lean(),
    conversationId && mongoose.isValidObjectId(conversationId)
      ? WaConversation.findOne(scoped(ctx, { _id: new mongoose.Types.ObjectId(conversationId) }))
          .select('updatedAt')
          .lean()
      : null,
  ])
  return {
    listAt: latest?.updatedAt?.toISOString() ?? null,
    threadAt: thread?.updatedAt?.toISOString() ?? null,
  }
}

/* ── opening a thread ─────────────────────────────────────────────────────── */

/**
 * The thread for an order's passenger, created if it does not exist yet.
 *
 * Scoped through orderRepo, so an order at an outlet this telecaller does not
 * hold is a 404 before any conversation is touched. An existing thread is
 * looked up through the caller's scope as well: one that another outlet
 * holds is refused, the way openConversationForPhone refuses it, rather than
 * quietly re-aimed into this outlet with its whole history. Within scope the
 * thread is re-aimed at this order — the person clicking is looking at it
 * right now — and claimed for the order's outlet if nobody held it yet.
 */
export async function openConversationForOrder(ctx: AuthContext, orderId: string): Promise<string> {
  assertChatRole(ctx)
  const order = await findByIdOrThrow(ctx, orderId)
  const phone = normalisePhone(order.contactPhone)
  if (!phone) throw new ConflictError('This order has no usable phone number')

  const existing = await WaConversation.findOne(scoped(ctx, { phone })).lean()
  if (existing) {
    await WaConversation.updateOne(
      { _id: existing._id },
      {
        $set: {
          orderId: order._id,
          // Claim an unclaimed thread for the order's outlet; never move a
          // claimed one, and never un-claim one with an outlet-less order.
          ...(existing.restaurantId === null && order.restaurantId ? { restaurantId: order.restaurantId } : {}),
          ...(order.contactName && !existing.customerName ? { customerName: order.contactName } : {}),
        },
      },
    )
    return String(existing._id)
  }

  const anywhere = await WaConversation.exists({ phone })
  if (anywhere) throw new ForbiddenError('That passenger is already in a conversation at another outlet')

  const now = new Date()
  const c = await WaConversation.create({
    phone,
    customerName: order.contactName ?? null,
    restaurantId: order.restaurantId ?? null,
    orderId: order._id,
    unreadCount: 0,
    // Sorts the fresh thread to the top of the rail: null would sort it last.
    lastMessageAt: now,
  })
  return String(c._id)
}

/**
 * A thread with a number the telecaller typed in. Claimed for the one outlet
 * they hold when they hold exactly one; left unclaimed otherwise, since there
 * is no order yet to say which it belongs to.
 */
export async function openConversationForPhone(
  ctx: AuthContext,
  rawPhone: string,
  name?: string | null,
): Promise<string> {
  assertChatRole(ctx)
  const phone = normalisePhone(rawPhone)
  if (!phone) throw new ConflictError('Enter a 10-digit mobile number, with or without +91')

  const existing = await WaConversation.findOne(scoped(ctx, { phone })).lean()
  if (existing) {
    if (name && !existing.customerName) {
      await WaConversation.updateOne({ _id: existing._id }, { $set: { customerName: name } })
    }
    return String(existing._id)
  }

  // Exists but out of scope: say "not yours" rather than create a duplicate
  // that would then collide on the unique phone index.
  const anywhere = await WaConversation.exists({ phone })
  if (anywhere) throw new ForbiddenError('That number is already in a conversation at another outlet')

  // A matching order within scope decides the outlet; otherwise the one
  // outlet this telecaller holds, if it is only one.
  const linked = await latestOrderFor(phone, ctx.role === 'ADMIN' ? null : ctx.restaurantIds)
  const restaurantId =
    linked?.restaurantId ?? (ctx.role === 'TELECALLER' && ctx.restaurantIds.length === 1 ? ctx.restaurantIds[0] : null)

  const c = await WaConversation.create({
    phone,
    customerName: name?.trim() || linked?.contactName || null,
    restaurantId,
    orderId: linked?._id ?? null,
    unreadCount: 0,
    lastMessageAt: new Date(),
  })
  return String(c._id)
}

/**
 * The newest order placed from this number, optionally within a set of
 * outlets. Orders store the number as the aggregator wrote it, so the match
 * is on the last ten digits.
 */
async function latestOrderFor(phone: string, restaurantIds: mongoose.Types.ObjectId[] | null) {
  const filter: QueryFilter<OrderDoc> = {
    contactPhone: { $regex: `${escapeRegExp(phoneTail(phone))}\\s*$` },
  }
  if (restaurantIds) filter.restaurantId = { $in: restaurantIds }
  return Order.findOne(filter).sort({ createdAt: -1, _id: -1 }).lean()
}

/* ── sending ──────────────────────────────────────────────────────────────── */

async function recordOutbound(
  ctx: AuthContext,
  c: WaConversationDoc,
  provider: WhatsAppProvider,
  draft: { kind: 'TEXT' | 'TEMPLATE'; text: string; templateName?: string },
  send: () => Promise<{ providerMessageId: string | null; providerRequestId: string | null }>,
) {
  const now = new Date()
  const msg = await WaMessage.create({
    conversationId: c._id,
    direction: 'OUT',
    kind: draft.kind,
    text: draft.text,
    templateName: draft.templateName ?? null,
    status: 'QUEUED',
    sentBy: ctx.userId,
    createdAt: now,
  })

  // The thread shows the line at once, as "sending": a telecaller should not
  // watch a blank space for the two seconds the provider takes.
  await WaConversation.updateOne(
    { _id: c._id },
    {
      $set: {
        lastMessageAt: now,
        lastMessageText: draft.text,
        lastMessageDirection: 'OUT',
        // Replying claims an unclaimed thread: whoever answered is now on it.
        ...(c.assignedTo ? {} : { assignedTo: ctx.userId }),
      },
    },
  )

  try {
    const result = await send()
    await WaMessage.updateOne(
      { _id: msg._id },
      {
        $set: {
          status: 'SENT',
          statusAt: new Date(),
          providerRequestId: result.providerRequestId,
          ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        },
      },
    )
    await WaConversation.updateOne({ _id: c._id }, { $currentDate: { updatedAt: true } })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Send failed'
    await WaMessage.updateOne(
      { _id: msg._id },
      { $set: { status: 'FAILED', statusAt: new Date(), failReason: reason } },
    )
    await WaConversation.updateOne({ _id: c._id }, { $currentDate: { updatedAt: true } })
    throw err
  }
  void provider
  return String(msg._id)
}

/**
 * A free-text reply. Refused when the 24-hour window is shut — the provider
 * would refuse it too, but later and less clearly.
 */
export async function sendText(
  ctx: AuthContext,
  conversationId: string,
  text: string,
  provider: WhatsAppProvider,
): Promise<string> {
  const c = await findConversationOrThrow(ctx, conversationId)
  const body = text.trim()
  if (!body) throw new ConflictError('Write something to send')
  if (body.length > WA_TEXT_MAX) throw new ConflictError(`Keep a message under ${WA_TEXT_MAX} characters`)

  const window = sessionWindow(c.lastInboundAt)
  if (!window.open) {
    throw new ConflictError(
      window.reason === 'never'
        ? 'The passenger has not written yet. Send the opener template first.'
        : 'More than 24 hours since the passenger last wrote. Send the opener template first.',
    )
  }

  return recordOutbound(ctx, c, provider, { kind: 'TEXT', text: body }, () =>
    provider.sendText(c.phone, body),
  )
}

/**
 * The approved template that opens (or reopens) a conversation. Allowed at
 * any time; this is the only thing that is.
 */
export async function sendOpenerTemplate(
  ctx: AuthContext,
  conversationId: string,
  provider: WhatsAppProvider,
  template: { name: string; language: string; vars?: readonly ('name' | 'order' | 'outlet')[] },
): Promise<string> {
  const c = await findConversationOrThrow(ctx, conversationId)
  if (!template.name) throw new ConflictError('No opener template is configured')

  // Through the caller's scope, like linkedOrder: an unclaimed thread may
  // point at another outlet's order, whose id is not this caller's to send.
  const order = await linkedOrder(ctx, c)
  const orderRef = order?.externalOrderId ?? ''
  const outlet = c.restaurantId ? await Restaurant.findById(c.restaurantId).select('name').lean() : null
  const fill: Record<'name' | 'order' | 'outlet', string> = {
    // A template variable may not be empty, so a nameless passenger gets a word.
    name: c.customerName?.trim() || 'there',
    order: orderRef || 'with us',
    outlet: outlet?.name ?? 'our outlet',
  }
  const bodyValues = (template.vars ?? ['order']).map((v) => fill[v])
  // What the passenger actually reads, when the provider can tell us the
  // template's wording; otherwise a one-line account of what went out.
  const body = (await provider.templateBody?.(template.name, template.language)) ?? null
  const text = body
    ? renderTemplateBody(body, bodyValues)
    : orderRef
      ? `Template ${template.name} sent about order ${orderRef}`
      : `Template ${template.name} sent`

  return recordOutbound(ctx, c, provider, { kind: 'TEMPLATE', text, templateName: template.name }, () =>
    provider.sendTemplate({ to: c.phone, name: template.name, language: template.language, bodyValues }),
  )
}

/* ── thread state ─────────────────────────────────────────────────────────── */

export async function markRead(ctx: AuthContext, conversationId: string): Promise<void> {
  const c = await findConversationOrThrow(ctx, conversationId)
  if (c.unreadCount === 0) return
  await WaConversation.updateOne({ _id: c._id }, { $set: { unreadCount: 0 } })
}

/**
 * Who answers this passenger. A telecaller may take a thread or let one go;
 * handing it to a named colleague is an admin's move, since it is the admin
 * who can see the whole desk.
 */
export async function assignConversation(
  ctx: AuthContext,
  conversationId: string,
  userId: string | null,
): Promise<void> {
  const c = await findConversationOrThrow(ctx, conversationId)
  if (ctx.role === 'TELECALLER') {
    if (userId !== null && userId !== String(ctx.userId)) {
      throw new ForbiddenError('A telecaller can only take a conversation themselves')
    }
    // Held by a colleague: neither taking it over nor letting it go is theirs
    // to do. Two people answering one passenger, or none, is what this stops.
    if (c.assignedTo && !c.assignedTo.equals(ctx.userId)) {
      throw new ForbiddenError('This conversation is held by someone else; ask an admin to reassign it')
    }
  }
  if (userId !== null) {
    if (!mongoose.isValidObjectId(userId)) throw new NotFoundError('User not found')
    const u = await User.exists({ _id: userId, active: true, role: { $in: ['TELECALLER', 'ADMIN'] } })
    if (!u) throw new NotFoundError('User not found')
  }
  await WaConversation.updateOne(
    { _id: c._id },
    { $set: { assignedTo: userId ? new mongoose.Types.ObjectId(userId) : null } },
  )
}

/* ── the webhook's two entry points (no caller context) ───────────────────── */

/**
 * A message from a passenger. Idempotent on the provider's message id, so a
 * redelivered webhook is a no-op. A number with no thread yet gets one, aimed
 * at their newest order if any outlet has one from this number.
 */
export async function recordInbound(
  ev: InboundEvent,
): Promise<{ conversationId: string; messageId: string | null; duplicate: boolean }> {
  let c = await WaConversation.findOne({ phone: ev.phone }).lean()
  if (!c) {
    const linked = await latestOrderFor(ev.phone, null)
    c = (
      await WaConversation.findOneAndUpdate(
        { phone: ev.phone },
        {
          $setOnInsert: {
            phone: ev.phone,
            customerName: ev.customerName ?? linked?.contactName ?? null,
            restaurantId: linked?.restaurantId ?? null,
            orderId: linked?._id ?? null,
            unreadCount: 0,
            lastMessageAt: ev.at,
          },
        },
        { upsert: true, returnDocument: 'after' },
      ).lean()
    )!
  }

  const preview = ev.text ?? (ev.kind === 'MEDIA' ? (ev.mediaCaption ?? 'Attachment') : 'Message')
  let messageId: string | null = null
  try {
    const m = await WaMessage.create({
      conversationId: c._id,
      direction: 'IN',
      kind: ev.kind,
      text: ev.text,
      mediaUrl: ev.mediaUrl,
      mediaCaption: ev.mediaCaption,
      mediaType: ev.mediaType ?? null,
      status: 'RECEIVED',
      statusAt: ev.at,
      providerMessageId: ev.providerMessageId,
      createdAt: ev.at,
    })
    messageId = String(m._id)
  } catch (err) {
    // E11000: this exact message is already in the thread.
    if ((err as { code?: number }).code === 11000) {
      return { conversationId: String(c._id), messageId: null, duplicate: true }
    }
    throw err
  }

  await WaConversation.updateOne(
    { _id: c._id },
    {
      $set: {
        lastMessageAt: ev.at,
        lastMessageText: preview,
        lastMessageDirection: 'IN',
        lastInboundAt: ev.at,
        ...(ev.customerName && !c.customerName ? { customerName: ev.customerName } : {}),
      },
      $inc: { unreadCount: 1 },
    },
  )
  return { conversationId: String(c._id), messageId, duplicate: false }
}

// FAILED sits above READ so a late delivery report cannot resurrect a dead
// message — MSG91 posts one call per event with no ordering guarantee.
const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 }

/**
 * A delivery report on something we sent. Only ever moves forward: a late
 * "delivered" arriving after "read" is ignored, and FAILED overrides all.
 */
export async function applyStatus(ev: StatusEvent): Promise<boolean> {
  const byId: QueryFilter<WaMessageDoc>[] = []
  if (ev.providerMessageId) byId.push({ providerMessageId: ev.providerMessageId })
  if (ev.providerRequestId) byId.push({ providerRequestId: ev.providerRequestId })
  if (byId.length === 0) return false

  const msg = await WaMessage.findOne({ direction: 'OUT', $or: byId }).lean()
  if (!msg) return false

  const forward = (RANK[ev.status] ?? 0) > (RANK[msg.status] ?? 0)
  if (!forward) return false

  await WaMessage.updateOne(
    { _id: msg._id },
    {
      $set: {
        status: ev.status,
        statusAt: ev.at,
        failReason: ev.status === 'FAILED' ? (ev.reason ?? 'Not delivered') : null,
        // The wamid may only now be known, if the send answered with a request id.
        ...(ev.providerMessageId && !msg.providerMessageId ? { providerMessageId: ev.providerMessageId } : {}),
      },
    },
  )
  await WaConversation.updateOne({ _id: msg.conversationId }, { $currentDate: { updatedAt: true } })
  return true
}

/* ── names for the screen ─────────────────────────────────────────────────── */

/**
 * Who a thread can be handed to: every active telecaller and admin. For the
 * admin's reassign control, so admin-only; a telecaller never sees a list of
 * colleagues to pick from because they may not pick one.
 */
export async function listAssignableChatUsers(ctx: AuthContext) {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin can reassign conversations')
  const rows = await User.find({ active: true, role: { $in: ['TELECALLER', 'ADMIN'] } })
    .select('name role')
    .sort({ role: -1, name: 1 })
    .lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, role: u.role as string }))
}

/** Outlet and user names for a page of threads, one query each. */
export async function labelsFor(
  rows: Pick<WaConversationDoc, 'restaurantId' | 'assignedTo'>[],
  extraUserIds: (mongoose.Types.ObjectId | null | undefined)[] = [],
) {
  const rIds = rows.map((r) => r.restaurantId).filter((v): v is mongoose.Types.ObjectId => Boolean(v))
  const uIds = [...rows.map((r) => r.assignedTo), ...extraUserIds].filter(
    (v): v is mongoose.Types.ObjectId => Boolean(v),
  )
  const [outlets, users] = await Promise.all([
    rIds.length ? Restaurant.find({ _id: { $in: rIds } }).select('name').lean() : [],
    uIds.length ? User.find({ _id: { $in: uIds } }).select('name').lean() : [],
  ])
  return {
    outletName: new Map(outlets.map((o) => [String(o._id), o.name])),
    userName: new Map(users.map((u) => [String(u._id), u.name])),
  }
}

/** The order a thread is about, read through the caller's scope. */
export async function linkedOrder(ctx: AuthContext, c: Pick<WaConversationDoc, 'orderId'>) {
  if (!c.orderId) return null
  try {
    return await findByIdOrThrow(ctx, String(c.orderId))
  } catch {
    return null
  }
}
