import mongoose, { Types } from 'mongoose'
import { connectDb } from '../db'
import { GMAIL_STATE_ID, IngestState, Mailbox, Tenant } from '../models'
import { tenantKey } from '../tenancy/primary'
import { seal } from '../crypto/secretBox'
import { startWatching, stopWatching } from '../ingest/gmail/sync'

/*
 * A company's linked Gmail (the mailbox its aggregator orders arrive in):
 * linking, changing and unlinking it. One per company; one company per
 * Gmail. Reading it is ingest/gmail/sync.
 */

export class MailboxError extends Error {}

export async function isGmailLinked(tenantId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(tenantId)) return false
  await connectDb()
  return Boolean(await Mailbox.exists({ tenantId: new Types.ObjectId(tenantId) }))
}

export type LinkedMailbox = {
  email: string
  linkedAt: Date
  foundAtLink: number | null
  lastError: string | null
  lastErrorAt: Date | null
  /** When an order (or bank alert) last came in from this company's mail. */
  lastMessageAt: Date | null
}

export async function mailboxOf(tenantId: string): Promise<LinkedMailbox | null> {
  if (!mongoose.isValidObjectId(tenantId)) return null
  await connectDb()
  const tid = new Types.ObjectId(tenantId)
  const [m, state] = await Promise.all([
    Mailbox.findOne({ tenantId: tid }).select('email linkedAt foundAtLink lastError lastErrorAt').lean(),
    IngestState.findOne({ _id: await tenantKey(tid, GMAIL_STATE_ID), tenantId: tid }).select('lastMessageAt').lean(),
  ])
  if (!m) return null
  return { email: m.email, linkedAt: m.linkedAt, foundAtLink: m.foundAtLink ?? null, lastError: m.lastError ?? null, lastErrorAt: m.lastErrorAt ?? null, lastMessageAt: state?.lastMessageAt ?? null }
}

/**
 * Links (or changes) a company's Gmail. A Gmail already feeding another
 * company is refused. Changing starts the new mailbox from now: its resume
 * point is set from Google's current position, so old mail is not imported.
 */
export async function linkMailbox(params: { tenantId: string; userId: string; email: string; refreshToken: string; historyId: string | null; found: number | null }): Promise<{ replaced: string | null }> {
  await connectDb()
  const tid = new Types.ObjectId(params.tenantId)
  const email = params.email.trim().toLowerCase()
  const elsewhere = await Mailbox.findOne({ email }).setOptions({ allTenants: true }).select('tenantId').lean()
  if (elsewhere && !elsewhere.tenantId.equals(tid)) {
    throw new MailboxError(`${email} is already linked to another company on RailServe. Use the Gmail that receives your own orders.`)
  }
  const old = await Mailbox.findOne({ tenantId: tid }).lean()
  if (old && old.email !== email) await stopWatching(old)

  const saved = await Mailbox.findOneAndUpdate(
    { tenantId: tid },
    {
      $set: { email, tokenSealed: seal(params.refreshToken), linkedAt: new Date(), linkedBy: new Types.ObjectId(params.userId), foundAtLink: params.found, lastError: null, lastErrorAt: null, watchExpiresAt: null },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean()

  // Resume from Google's position now. Unset when unknown: the first sync
  // then seeds it from the newest message, never importing the backlog.
  const stateId = await tenantKey(tid, GMAIL_STATE_ID)
  await IngestState.updateOne(
    { _id: stateId, tenantId: tid },
    params.historyId ? { $set: { historyId: params.historyId, lastError: null } } : { $unset: { historyId: 1 }, $set: { lastError: null } },
    { upsert: true },
  )
  // Watched only once the company is let in; a company still joining is
  // watched from the moment it is approved (onboardingRepo.activateIfReady).
  const active = await Tenant.exists({ _id: tid, status: 'ACTIVE' })
  if (saved && active) {
    try {
      await startWatching(saved)
    } catch (err) {
      // Not fatal: the every-minute sync still reads it, and the daily job retries the watch.
      await Mailbox.updateOne({ _id: saved._id, tenantId: tid }, { $set: { lastError: err instanceof Error ? err.message : 'watch failed', lastErrorAt: new Date() } })
    }
  }
  return { replaced: old && old.email !== email ? old.email : null }
}

/** Unlinks the company's Gmail: no more orders are read from it. */
export async function unlinkMailbox(tenantId: string): Promise<string | null> {
  await connectDb()
  const tid = new Types.ObjectId(tenantId)
  const m = await Mailbox.findOne({ tenantId: tid }).lean()
  if (!m) return null
  await stopWatching(m)
  await Mailbox.deleteOne({ _id: m._id, tenantId: tid })
  await IngestState.updateOne({ _id: await tenantKey(tid, GMAIL_STATE_ID), tenantId: tid }, { $unset: { historyId: 1, watchExpiresAt: 1 } })
  return m.email
}

/**
 * A company has just been let in: its Gmail is read from now on. The resume
 * point is cleared, so the first read starts at the newest mail rather than
 * turning everything since it was linked into orders, and the watch starts.
 */
export async function startReadingOnApproval(tenantId: string): Promise<void> {
  await connectDb()
  const tid = new Types.ObjectId(tenantId)
  await IngestState.updateOne({ _id: await tenantKey(tid, GMAIL_STATE_ID), tenantId: tid }, { $unset: { historyId: 1 } })
  const m = await Mailbox.findOne({ tenantId: tid }).lean()
  if (!m) return
  try {
    await startWatching(m)
  } catch (err) {
    await Mailbox.updateOne({ _id: m._id, tenantId: tid }, { $set: { lastError: err instanceof Error ? err.message : 'watch failed', lastErrorAt: new Date() } })
  }
}
