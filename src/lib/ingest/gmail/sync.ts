import type { Types } from 'mongoose'
import type { gmail_v1 } from 'googleapis'
import { connectDb } from '../../db'
import { GMAIL_STATE_ID, IngestState, Mailbox, Tenant } from '../../models'
import { env } from '../../env'
import { ingestEmail, type IngestOutcome } from '../index'
import { extractBody, gmailClient, gmailClientFor, headerValue, isGmailConfigured } from './client'
import { gmailAuthHeader } from '../mailAuth'
import { getPrimaryTenantId, tenantKey } from '../../tenancy/primary'
import { open } from '../../crypto/secretBox'

/*
 * Reading Gmail into orders, for two kinds of mailbox:
 *
 *  - the SERVER mailbox: the one set up by environment variables
 *    (GMAIL_REFRESH_TOKEN), feeding the primary company. Unchanged from
 *    before linked mailboxes existed: same token, same state row.
 *  - LINKED mailboxes: a company's own Gmail, linked from the app (Mailbox).
 *
 * Both read the same way (a "source": which company, which Gmail client) and
 * keep their resume point and sender rules in that company's IngestState. If
 * the primary company ever links a Gmail from the app, the server mailbox
 * steps aside, so no mailbox is ever read twice.
 */

type Source = {
  tenantId: Types.ObjectId
  gmail: gmail_v1.Gmail
  userId: string
  /** Set for a linked mailbox, to record its errors on its own row. */
  mailboxId?: Types.ObjectId
}

async function stateFilter(tenantId: Types.ObjectId) {
  return { _id: await tenantKey(tenantId, GMAIL_STATE_ID), tenantId }
}

/** The server mailbox, unless it is not set up or the primary company linked its own instead. */
async function serverSource(): Promise<Source | null> {
  if (!isGmailConfigured()) return null
  const tenantId = await getPrimaryTenantId()
  if (await Mailbox.exists({ tenantId })) return null
  return { tenantId, gmail: gmailClient(), userId: env.GMAIL_USER_ID }
}

/**
 * Linked mailboxes of companies that are let in. A company still joining, or
 * suspended, is not read: its mail would become orders nobody cooks, for
 * kitchens it may not have yet. On approval it is read from that moment on
 * (onboardingRepo.activateIfReady).
 */
async function activeMailboxes() {
  const boxes = await Mailbox.find({}).setOptions({ allTenants: true }).lean()
  if (boxes.length === 0) return []
  const active = new Set((await Tenant.find({ _id: { $in: boxes.map((b) => b.tenantId) }, status: 'ACTIVE' }).select('_id').lean()).map((t) => String(t._id)))
  return boxes.filter((b) => active.has(String(b.tenantId)))
}

function linkedSource(m: { _id: Types.ObjectId; tenantId: Types.ObjectId; tokenSealed: string }): Source {
  return { tenantId: m.tenantId, gmail: gmailClientFor(open(m.tokenSealed)), userId: 'me', mailboxId: m._id }
}

/* ── watch ──────────────────────────────────────────────────────────────── */

async function renewWatch(src: Source): Promise<{ expiresAt: Date | null; historyId: string | null }> {
  // No topic: this server is not the one Gmail pushes to (staging, local).
  // Registering a watch here would replace production's for that mailbox.
  if (!env.GMAIL_TOPIC_NAME) return { expiresAt: null, historyId: null }
  const res = await src.gmail.users.watch({
    userId: src.userId,
    requestBody: { topicName: env.GMAIL_TOPIC_NAME, labelIds: ['INBOX'] },
  })
  const expiresAt = res.data.expiration ? new Date(Number(res.data.expiration)) : null
  const historyId = res.data.historyId ?? null
  await IngestState.findOneAndUpdate(
    await stateFilter(src.tenantId),
    {
      $set: { watchExpiresAt: expiresAt, lastWatchRenewalAt: new Date(), lastError: null },
      // Only seed historyId on first registration — overwriting it on every
      // renewal would skip anything that arrived since the last sync.
      $setOnInsert: { historyId },
    },
    { upsert: true, returnDocument: 'after' },
  )
  if (src.mailboxId) await Mailbox.updateOne({ _id: src.mailboxId, tenantId: src.tenantId }, { $set: { watchExpiresAt: expiresAt } })
  return { expiresAt, historyId }
}

/**
 * Registers (or renews) the Gmail push watch for the server mailbox.
 *
 * Plan §6/§13.4: the watch expires after 7 days and ingestion then stops with
 * no error anywhere, so a daily cron renews it (/api/cron/gmail-watch).
 */
export async function renewGmailWatch(): Promise<{ expiresAt: Date | null; historyId: string | null }> {
  if (!isGmailConfigured() || !env.GMAIL_TOPIC_NAME) return { expiresAt: null, historyId: null }
  await connectDb()
  const src = await serverSource()
  if (!src) return { expiresAt: null, historyId: null }
  return renewWatch(src)
}

/** Renews every linked mailbox's watch. One failing does not stop the rest. */
export async function renewLinkedWatches(): Promise<{ email: string; ok: boolean; error?: string }[]> {
  if (!env.GMAIL_TOPIC_NAME) return []
  await connectDb()
  const boxes = await activeMailboxes()
  const out: { email: string; ok: boolean; error?: string }[] = []
  for (const m of boxes) {
    try {
      await renewWatch(linkedSource(m))
      out.push({ email: m.email, ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'watch failed'
      await Mailbox.updateOne({ _id: m._id, tenantId: m.tenantId }, { $set: { lastError: message, lastErrorAt: new Date() } })
      out.push({ email: m.email, ok: false, error: message })
    }
  }
  return out
}

/** Starts watching a just-linked mailbox. Exported for the link step. */
export async function startWatching(m: { _id: Types.ObjectId; tenantId: Types.ObjectId; tokenSealed: string }): Promise<void> {
  await renewWatch(linkedSource(m))
}

/** Stops Gmail pushing for a mailbox being unlinked. Best effort: the token may already be revoked. */
export async function stopWatching(m: { _id: Types.ObjectId; tenantId: Types.ObjectId; tokenSealed: string }): Promise<void> {
  if (!env.GMAIL_TOPIC_NAME) return
  try {
    await linkedSource(m).gmail.users.stop({ userId: 'me' })
  } catch {
    // Nothing to do: an unlinked mailbox is no longer read either way.
  }
}

/* ── reading ────────────────────────────────────────────────────────────── */

async function seedHistoryIdFromLatestMessage(src: Source): Promise<string | null> {
  const list = await src.gmail.users.messages.list({ userId: src.userId, maxResults: 1 })
  const latestId = list.data.messages?.[0]?.id
  if (!latestId) return null

  const msg = await src.gmail.users.messages.get({
    userId: src.userId,
    id: latestId,
    format: 'minimal',
  })
  const historyId = msg.data.historyId ?? null
  if (historyId) {
    await IngestState.findOneAndUpdate(
      await stateFilter(src.tenantId),
      { $set: { historyId, lastError: null } },
      { upsert: true },
    )
  }
  return historyId
}

export function isOutgoing(labelIds: readonly string[] | null | undefined): boolean {
  return (labelIds ?? []).some((l) => l === 'SENT' || l === 'DRAFT')
}

export type SyncSummary = {
  processed: number
  created: number
  duplicates: number
  payments: number
  unparsed: number
  ignored: number
  errors: string[]
}

const emptySummary = (): SyncSummary => ({ processed: 0, created: 0, duplicates: 0, payments: 0, unparsed: 0, ignored: 0, errors: [] })

async function syncSource(src: Source): Promise<SyncSummary> {
  const summary = emptySummary()
  const filter = await stateFilter(src.tenantId)
  const state = await IngestState.findOne(filter)

  if (!state?.historyId) {
    // No resume point yet — seed one from the latest message and catch up
    // starting next tick, rather than importing the entire mailbox now.
    await seedHistoryIdFromLatestMessage(src)
    return summary
  }

  const messageIds = new Set<string>()
  let pageToken: string | undefined
  let newHistoryId = state.historyId

  try {
    do {
      const res = await src.gmail.users.history.list({
        userId: src.userId,
        startHistoryId: state.historyId,
        historyTypes: ['messageAdded'],
        pageToken,
      })
      for (const h of res.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (isOutgoing(added.message?.labelIds)) {
            summary.ignored += 1
            continue
          }
          if (added.message?.id) messageIds.add(added.message.id)
        }
      }
      if (res.data.historyId) newHistoryId = res.data.historyId
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'history.list failed'
    summary.errors.push(message)
    await IngestState.updateOne(filter, { $set: { lastError: message } })
    if (src.mailboxId) await Mailbox.updateOne({ _id: src.mailboxId, tenantId: src.tenantId }, { $set: { lastError: message, lastErrorAt: new Date() } })
    if (/404|startHistoryId/i.test(message)) await seedHistoryIdFromLatestMessage(src)
    return summary
  }

  for (const id of messageIds) {
    try {
      const msg = await src.gmail.users.messages.get({
        userId: src.userId,
        id,
        format: 'full',
      })
      // The history entry can predate a label change, so check the message too.
      if (isOutgoing(msg.data.labelIds)) {
        summary.ignored += 1
        continue
      }
      const headers = msg.data.payload?.headers
      const outcome: IngestOutcome = await ingestEmail({
        tenantId: state.tenantId,
        body: extractBody(msg.data.payload),
        receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date(),
        gmailMessageId: id,
        subject: headerValue(headers, 'Subject'),
        from: headerValue(headers, 'From'),
        allowedSenders: state.allowedSenders ?? [],
        mailbox: { enforceSenders: state.enforceSenders === true, authResults: gmailAuthHeader(headers) },
      })
      summary.processed += 1
      if (outcome.status === 'CREATED') summary.created += 1
      else if (outcome.status === 'DUPLICATE') summary.duplicates += 1
      else if (outcome.status === 'PAYMENT') summary.payments += 1
      // A replayed payment alert is a no-op, like a replayed order — counted
      // with the duplicates rather than as a payment that just arrived.
      else if (outcome.status === 'PAYMENT_DUPLICATE') summary.duplicates += 1
      else if (outcome.status === 'IGNORED') summary.ignored += 1
      else summary.unparsed += 1
    } catch (err) {
      summary.errors.push(`${id}: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  await IngestState.updateOne(filter, {
    $set: {
      historyId: newHistoryId,
      ...(summary.created > 0 || summary.payments > 0 ? { lastMessageAt: new Date() } : {}),
      lastError: summary.errors.length ? summary.errors.join('; ') : null,
    },
  })
  if (src.mailboxId) {
    await Mailbox.updateOne({ _id: src.mailboxId, tenantId: src.tenantId }, { $set: summary.errors.length ? { lastError: summary.errors.join('; '), lastErrorAt: new Date() } : { lastError: null } })
  }
  return summary
}

/** Reads new mail from the server mailbox. Unchanged behaviour; a no-op when it is not set up. */
export async function syncGmailHistory(): Promise<SyncSummary> {
  if (!isGmailConfigured()) return emptySummary()
  await connectDb()
  const src = await serverSource()
  return src ? syncSource(src) : emptySummary()
}

/** Reads new mail from one linked mailbox. */
export async function syncMailbox(m: { _id: Types.ObjectId; tenantId: Types.ObjectId; tokenSealed: string }): Promise<SyncSummary> {
  await connectDb()
  try {
    return await syncSource(linkedSource(m))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed'
    await Mailbox.updateOne({ _id: m._id, tenantId: m.tenantId }, { $set: { lastError: message, lastErrorAt: new Date() } })
    return { ...emptySummary(), errors: [message] }
  }
}

/** Reads every linked mailbox; the polling fallback behind push. */
export async function syncLinkedMailboxes(): Promise<{ email: string; summary: SyncSummary }[]> {
  await connectDb()
  const boxes = await activeMailboxes()
  const out: { email: string; summary: SyncSummary }[] = []
  for (const m of boxes) out.push({ email: m.email, summary: await syncMailbox(m) })
  return out
}

/**
 * Which mailbox a Gmail push is about. Pub/Sub sends `{ emailAddress,
 * historyId }`, base64 JSON in `message.data`. A linked mailbox with that
 * address is synced; anything else (including a body we cannot read) falls
 * back to the server mailbox, exactly as before linked mailboxes existed.
 */
export function pushedAddress(body: unknown): string | null {
  try {
    const data = (body as { message?: { data?: string } } | null)?.message?.data
    if (!data) return null
    const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as { emailAddress?: unknown }
    return typeof decoded.emailAddress === 'string' ? decoded.emailAddress.trim().toLowerCase() : null
  } catch {
    return null
  }
}

export async function syncForPush(body: unknown): Promise<{ mailbox: 'linked' | 'server'; summary: SyncSummary }> {
  await connectDb()
  const address = pushedAddress(body)
  const linked = address ? await Mailbox.findOne({ email: address }).setOptions({ allTenants: true }).lean() : null
  if (linked) {
    // A company not let in (joining, suspended) is not read; and its address
    // is never mistaken for the server mailbox either.
    const active = await Tenant.exists({ _id: linked.tenantId, status: 'ACTIVE' })
    return { mailbox: 'linked', summary: active ? await syncMailbox(linked) : emptySummary() }
  }
  return { mailbox: 'server', summary: await syncGmailHistory() }
}

/* ── health ─────────────────────────────────────────────────────────────── */

/**
 * Plan §6: "alert if no order has arrived in N hours during business hours."
 * A silent watch expiry is invisible otherwise — the system looks healthy and
 * simply stops receiving work.
 *
 * For the primary company with no linked mailbox, this is the server mailbox
 * as before; for any company with a linked mailbox, that mailbox.
 */
export async function checkIngestStaleness(now = new Date(), tenantId?: Types.ObjectId): Promise<{
  stale: boolean
  hoursSinceLastOrder: number | null
  watchExpiresInHours: number | null
  message: string | null
}> {
  await connectDb()
  const primaryId = await getPrimaryTenantId()
  const tid = tenantId ?? primaryId
  const linked = await Mailbox.findOne({ tenantId: tid }).select('email').lean()
  const usesServerMailbox = !linked && tid.equals(primaryId) && isGmailConfigured()
  if (!linked && !usesServerMailbox) {
    return { stale: false, hoursSinceLastOrder: null, watchExpiresInHours: null, message: null }
  }
  const state = await IngestState.findOne(await stateFilter(tid)).lean()

  const istHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
    }).format(now),
  )
  const businessHours = istHour >= 7 && istHour < 23

  const hoursSinceLastOrder = state?.lastMessageAt
    ? (now.getTime() - state.lastMessageAt.getTime()) / 3_600_000
    : null
  const watchExpiresInHours = state?.watchExpiresAt
    ? (state.watchExpiresAt.getTime() - now.getTime()) / 3_600_000
    : null

  const messages: string[] = []

  // Checked first, and without the business-hours guard the other two carry,
  // because a rejected credential is the one failure that never recovers on
  // its own: /api/cron/gmail-sync answers 200 with the error tucked inside
  // `errors` so the scheduler does not retry what it cannot fix, which leaves
  // a dead token looking exactly like a quiet mailbox. Waiting
  // INGEST_STALE_ALERT_HOURS to say so is six hours of orders nobody cooks —
  // the outage of 2026-09-16 ran for 1h54m and was noticed only because a
  // human counted four orders on the board.
  if (state?.lastError) {
    const rejected = /invalid_grant|invalid_client|unauthorized_client/i.test(state.lastError)
    messages.push(
      rejected
        ? linked
          ? `Google stopped letting RailServe read ${linked.email}. Link it again in Settings → Order emails.`
          : 'Gmail rejected the credentials: GMAIL_REFRESH_TOKEN must be reissued ' +
            '(`npm run gmail:setup`, then update .env.production and restart)'
        : `last Gmail sync reported: ${state.lastError}`,
    )
  }

  if (watchExpiresInHours !== null && watchExpiresInHours < 24) {
    messages.push(`Gmail watch expires in ${watchExpiresInHours.toFixed(1)}h`)
  }
  if (
    businessHours &&
    hoursSinceLastOrder !== null &&
    hoursSinceLastOrder > env.INGEST_STALE_ALERT_HOURS
  ) {
    messages.push(
      `no order ingested for ${hoursSinceLastOrder.toFixed(1)}h during business hours`,
    )
  }

  return {
    stale: messages.length > 0,
    hoursSinceLastOrder,
    watchExpiresInHours,
    message: messages.length ? messages.join('; ') : null,
  }
}
