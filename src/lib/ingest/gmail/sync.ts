import { connectDb } from '../../db'
import { GMAIL_STATE_ID, IngestState } from '../../models'
import { env } from '../../env'
import { ingestEmail, type IngestOutcome } from '../index'
import { extractBody, gmailClient, headerValue, isGmailConfigured } from './client'

/**
 * Registers (or renews) the Gmail push watch.
 *
 * Plan §6/§13.4: the watch expires after 7 days and ingestion then stops with
 * no error raised anywhere. The worker renews it daily.
 */
export async function renewGmailWatch(): Promise<{ expiresAt: Date | null; historyId: string | null }> {
  if (!isGmailConfigured() || !env.GMAIL_TOPIC_NAME) {
    return { expiresAt: null, historyId: null }
  }

  await connectDb()
  const gmail = gmailClient()

  const res = await gmail.users.watch({
    userId: env.GMAIL_USER_ID,
    requestBody: { topicName: env.GMAIL_TOPIC_NAME, labelIds: ['INBOX'] },
  })

  const expiresAt = res.data.expiration ? new Date(Number(res.data.expiration)) : null
  const historyId = res.data.historyId ?? null

  await IngestState.findOneAndUpdate(
    { _id: GMAIL_STATE_ID },
    {
      $set: { watchExpiresAt: expiresAt, lastWatchRenewalAt: new Date(), lastError: null },
      // Only seed historyId on first registration — overwriting it on every
      // renewal would skip anything that arrived since the last sync.
      $setOnInsert: { historyId },
    },
    { upsert: true, returnDocument: 'after' },
  )

  return { expiresAt, historyId }
}

export type SyncSummary = {
  processed: number
  created: number
  duplicates: number
  unparsed: number
  errors: string[]
}

/**
 * Pulls everything since the stored historyId and ingests it.
 *
 * Advancing historyId only after a successful pass means a crash re-processes
 * rather than skips — safe, because ingestion is idempotent on both
 * externalOrderId and gmailMessageId.
 */
export async function syncGmailHistory(): Promise<SyncSummary> {
  const summary: SyncSummary = { processed: 0, created: 0, duplicates: 0, unparsed: 0, errors: [] }
  if (!isGmailConfigured()) return summary

  await connectDb()
  const gmail = gmailClient()
  const state = await IngestState.findOne({ _id: GMAIL_STATE_ID })

  if (!state?.historyId) {
    // No resume point: register the watch, which gives us one, and wait for the
    // next notification rather than importing the entire mailbox.
    await renewGmailWatch()
    return summary
  }

  const messageIds = new Set<string>()
  let pageToken: string | undefined
  let newHistoryId = state.historyId

  try {
    do {
      const res = await gmail.users.history.list({
        userId: env.GMAIL_USER_ID,
        startHistoryId: state.historyId,
        historyTypes: ['messageAdded'],
        pageToken,
      })
      for (const h of res.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.id) messageIds.add(added.message.id)
        }
      }
      if (res.data.historyId) newHistoryId = res.data.historyId
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (err) {
    // A 404 means the historyId is too old to resume from. Re-registering the
    // watch resets it; messages in the gap are lost to history sync, which is
    // exactly what the no-orders-in-N-hours alert is there to surface.
    const message = err instanceof Error ? err.message : 'history.list failed'
    summary.errors.push(message)
    await IngestState.updateOne({ _id: GMAIL_STATE_ID }, { $set: { lastError: message } })
    if (/404|startHistoryId/i.test(message)) await renewGmailWatch()
    return summary
  }

  for (const id of messageIds) {
    try {
      const msg = await gmail.users.messages.get({
        userId: env.GMAIL_USER_ID,
        id,
        format: 'full',
      })
      const headers = msg.data.payload?.headers
      const outcome: IngestOutcome = await ingestEmail({
        body: extractBody(msg.data.payload),
        receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date(),
        gmailMessageId: id,
        subject: headerValue(headers, 'Subject'),
        from: headerValue(headers, 'From'),
      })
      summary.processed += 1
      if (outcome.status === 'CREATED') summary.created += 1
      else if (outcome.status === 'DUPLICATE') summary.duplicates += 1
      else summary.unparsed += 1
    } catch (err) {
      summary.errors.push(`${id}: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  await IngestState.updateOne(
    { _id: GMAIL_STATE_ID },
    {
      $set: {
        historyId: newHistoryId,
        ...(summary.created > 0 ? { lastMessageAt: new Date() } : {}),
        lastError: summary.errors.length ? summary.errors.join('; ') : null,
      },
    },
  )

  return summary
}

/**
 * Plan §6: "alert if no order has arrived in N hours during business hours."
 * A silent watch expiry is invisible otherwise — the system looks healthy and
 * simply stops receiving work.
 */
export async function checkIngestStaleness(now = new Date()): Promise<{
  stale: boolean
  hoursSinceLastOrder: number | null
  watchExpiresInHours: number | null
  message: string | null
}> {
  await connectDb()
  const state = await IngestState.findOne({ _id: GMAIL_STATE_ID }).lean()

  if (!isGmailConfigured()) {
    return { stale: false, hoursSinceLastOrder: null, watchExpiresInHours: null, message: null }
  }

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
