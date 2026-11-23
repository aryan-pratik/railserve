'use server'

import { revalidatePath } from 'next/cache'
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import { requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { GMAIL_STATE_ID, IngestState, MailSource, UnparsedInbox } from '@/lib/models'
import { recentOrderEmails } from '@/lib/repo/mailSourceRepo'
import { normaliseSenderEntry, senderAddress } from '@/lib/ingest/senders'
import { listsSender } from '@/lib/ingest/mailSources'
import { isBuiltinKey } from '@/lib/v2/mailSettings'
import { reingestInboxRow } from '@/lib/repo/inboxRepo'
import { toParseableText } from '@/lib/ingest/gmail/client'
import { normaliseBody, runTemplate, validateRules } from '@/lib/ingest/templates/engine'
import { ORDER_SOURCES, SOURCE_LABEL, type OrderSource } from '@/lib/orderEnums'
import { tenantKey } from '@/lib/tenancy/primary'
import { PAYMENT_PARSERS } from '@/lib/ingest/payments'

/*
 * Settings → Order emails, and the layout builder. Senders decide what
 * becomes an order, so every action here needs the admin-only
 * company.manage permission.
 */

const V2 = '/v2/settings'
export type MailActionState = { ok?: string; error?: string }

const done = (ok: string): MailActionState => {
  revalidatePath(V2)
  revalidatePath('/v2/inbox')
  return { ok }
}

/** The "only known senders" switch. */
export async function setEnforceSenders(on: boolean): Promise<MailActionState> {
  const ctx = await requirePermission('company.manage')
  await connectDb()
  await IngestState.updateOne(
    { _id: await tenantKey(ctx.tenantId, GMAIL_STATE_ID), tenantId: ctx.tenantId },
    { $set: { enforceSenders: on } },
    { upsert: true },
  )
  return done(on ? 'Only listed senders can create orders now.' : 'Checking senders is off. Any sender can create orders again.')
}

/** The row for a key, created for a built-in reader on first use. */
async function rowFor(tenantId: mongoose.Types.ObjectId, key: string, userId: mongoose.Types.ObjectId | string | null) {
  const existing = await MailSource.findOne({ tenantId, key })
  if (existing) return existing
  const b = isBuiltinKey(key)
  if (!b) return null
  return MailSource.findOneAndUpdate(
    { tenantId, key },
    { $setOnInsert: { tenantId, key, kind: b.kind, name: b.name, source: b.source, senders: [], updatedById: userId } },
    { upsert: true, new: true },
  )
}

export async function addSourceSender(key: string, raw: string): Promise<MailActionState> {
  const ctx = await requirePermission('company.manage')
  const entry = normaliseSenderEntry(raw)
  if (!entry) return { error: 'Enter an email address like orders@zoop.in, or a whole domain like @zoop.in.' }
  if (/^@(gmail|yahoo|outlook|hotmail|rediffmail|icloud)\.com$/.test(entry)) {
    return { error: `${entry} is a public mail service: anyone can get an address there. List the exact address instead.` }
  }
  await connectDb()
  const row = await rowFor(ctx.tenantId, key, ctx.userId)
  if (!row) return { error: 'That source no longer exists.' }
  // Anyone can type a personal address into a From line, so listing one
  // also asks Gmail to confirm each mail really came from that mailbox.
  const personal = /@(gmail|googlemail|yahoo|outlook|hotmail|live|rediffmail|icloud|proton|protonmail)\.[a-z.]+$/i.test(entry)
  await MailSource.updateOne(
    { _id: row._id, tenantId: ctx.tenantId },
    { $addToSet: { senders: entry }, $set: { updatedById: ctx.userId, ...(personal ? { requireVerified: true } : {}) } },
  )
  return done(personal ? `${entry} can now send ${row.name} orders, once Gmail confirms each one is genuine.` : `${entry} can now send ${row.name} orders.`)
}

export async function removeSourceSender(key: string, entry: string): Promise<MailActionState> {
  const ctx = await requirePermission('company.manage')
  await connectDb()
  await MailSource.updateOne({ tenantId: ctx.tenantId, key }, { $pull: { senders: entry }, $set: { updatedById: ctx.userId } })
  return done(`Removed ${entry}.`)
}

export async function setSourceVerified(key: string, on: boolean): Promise<MailActionState> {
  const ctx = await requirePermission('company.manage')
  await connectDb()
  const row = await rowFor(ctx.tenantId, key, ctx.userId)
  if (!row) return { error: 'That source no longer exists.' }
  await MailSource.updateOne({ _id: row._id, tenantId: ctx.tenantId }, { $set: { requireVerified: on, updatedById: ctx.userId } })
  return done(on ? `${row.name}: only mail Gmail confirms is genuine.` : `${row.name}: Gmail's check is not required.`)
}

export async function setSourceActive(key: string, on: boolean): Promise<MailActionState> {
  const ctx = await requirePermission('company.manage')
  await connectDb()
  const row = await rowFor(ctx.tenantId, key, ctx.userId)
  if (!row) return { error: 'That source no longer exists.' }
  await MailSource.updateOne({ _id: row._id, tenantId: ctx.tenantId }, { $set: { active: on, updatedById: ctx.userId } })
  return done(on ? `${row.name} is on.` : `${row.name} is paused.`)
}

export async function deleteTaughtSource(key: string): Promise<MailActionState> {
  const ctx = await requirePermission('company.manage')
  await connectDb()
  const r = await MailSource.deleteOne({ tenantId: ctx.tenantId, key, kind: 'TAUGHT' })
  return r.deletedCount ? done('Layout deleted.') : { error: 'That layout no longer exists.' }
}

/**
 * "Trust this sender" on an email held back for an unknown sender: lists the
 * sender for the source that recognised it, then reads the email again.
 */
export async function trustSenderFromInbox(inboxId: string): Promise<MailActionState> {
  const ctx = await requirePermission('company.manage')
  if (!mongoose.isValidObjectId(inboxId)) return { error: 'That email no longer exists.' }
  await connectDb()
  const row = await UnparsedInbox.findOne({ _id: inboxId, tenantId: ctx.tenantId }).select('source rawPayload reason').lean()
  if (!row) return { error: 'That email no longer exists.' }
  const raw = (row.rawPayload ?? {}) as { from?: string | null; body?: string }
  const address = senderAddress(raw.from)
  if (!address) return { error: 'This email has no sender address to trust.' }
  const key = PAYMENT_PARSERS.some((p) => p.provider === row.source) ? `PAY:${row.source}` : row.source
  const src = await rowFor(ctx.tenantId, key, ctx.userId)
  if (!src) return { error: 'No source recognised this email, so there is nothing to trust it for.' }
  const personal = /@(gmail|googlemail|yahoo|outlook|hotmail|live|rediffmail|icloud|proton|protonmail)\.[a-z.]+$/i.test(address)
  await MailSource.updateOne(
    { _id: src._id, tenantId: ctx.tenantId },
    { $addToSet: { senders: address }, $set: { updatedById: ctx.userId, ...(personal ? { requireVerified: true } : {}) } },
  )
  const again = await reingestInboxRow(ctx, inboxId, raw.body ?? '')
  revalidatePath(V2)
  revalidatePath('/v2/inbox')
  return again.error
    ? { ok: `${address} is now trusted for ${src.name}, but this email still needs a look: ${again.error}` }
    : { ok: `${address} is now trusted for ${src.name}. ${again.ok ?? ''}`.trim() }
}

/* ── the layout builder ─────────────────────────────────────────────── */

export type SampleEmail = { id: string; kind: 'waiting' | 'order'; subject: string | null; from: string | null; receivedAt: string | null; body: string }

const asSample = (id: string, kind: SampleEmail['kind'], raw: unknown): SampleEmail | null => {
  const r = (raw ?? {}) as { body?: unknown; subject?: unknown; from?: unknown; receivedAt?: unknown }
  if (typeof r.body !== 'string' || !r.body.trim()) return null
  return {
    id, kind,
    subject: typeof r.subject === 'string' ? r.subject : null,
    from: typeof r.from === 'string' ? r.from : null,
    receivedAt: r.receivedAt ? new Date(r.receivedAt as string).toISOString() : null,
    body: normaliseBody(toParseableText(r.body)),
  }
}

/** Recent emails waiting in "Emails to check", to teach from. */
export async function loadTeachSamples(): Promise<SampleEmail[]> {
  const ctx = await requirePermission('company.manage')
  await connectDb()
  const rows = await UnparsedInbox.find({ tenantId: ctx.tenantId, resolved: false }).sort({ createdAt: -1 }).limit(40).select('rawPayload').lean()
  return rows.map((r) => asSample(String(r._id), 'waiting', r.rawPayload)).filter((x): x is SampleEmail => x !== null)
}

export async function loadTeachSample(inboxId: string): Promise<SampleEmail | null> {
  const ctx = await requirePermission('company.manage')
  if (!mongoose.isValidObjectId(inboxId)) return null
  await connectDb()
  const r = await UnparsedInbox.findOne({ _id: inboxId, tenantId: ctx.tenantId }).select('rawPayload').lean()
  return r ? asSample(String(r._id), 'waiting', r.rawPayload) : null
}

export type TestRow = {
  id: string
  subject: string | null
  from: string | null
  receivedAt: string | null
  ok: boolean
  detail: string
  order: { externalOrderId: string; contactName: string | null; trainNo: string | null; seat: string | null; items: string[]; amount: number | null } | null
}

/**
 * Runs a layout on the sample and on recent mail from the same senders, both
 * waiting emails and ones that already became orders, so a mistake shows up
 * before the layout is saved.
 */
export async function testLayout(input: { rules: unknown; source: string; senders: string[]; sample: string; sampleReceivedAt: string | null }): Promise<{ error?: string; rows?: TestRow[] }> {
  const ctx = await requirePermission('company.manage')
  let rules
  try {
    rules = validateRules(input.rules)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const source = (ORDER_SOURCES as readonly string[]).includes(input.source) ? (input.source as OrderSource) : 'OTHER'
  const run = (id: string, s: SampleEmail): TestRow => {
    const r = runTemplate(s.body, rules, source, s.receivedAt ? new Date(s.receivedAt) : new Date())
    const o = r.ok ? r.order : null
    return {
      id, subject: s.subject, from: s.from, receivedAt: s.receivedAt, ok: r.ok,
      detail: r.ok ? 'Reads as an order' : r.detail.replace(' (taught layout)', ''),
      order: o
        ? { externalOrderId: o.externalOrderId, contactName: o.contactName, trainNo: o.trainNo, seat: o.rawSeat, items: o.items.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)), amount: o.amountPaise }
        : null,
    }
  }
  const out: TestRow[] = [run('sample', { id: 'sample', kind: 'waiting', subject: 'The email you are teaching from', from: null, receivedAt: input.sampleReceivedAt, body: normaliseBody(input.sample) })]
  const senders = input.senders.map((s) => normaliseSenderEntry(s)).filter((s): s is string => s !== null)
  if (senders.length) {
    await connectDb()
    const since = new Date(Date.now() - 60 * 24 * 3_600_000)
    const [waiting, orders] = await Promise.all([
      UnparsedInbox.find({ tenantId: ctx.tenantId, createdAt: { $gte: since }, 'rawPayload.from': { $type: 'string' } }).sort({ createdAt: -1 }).limit(300).select('rawPayload').lean(),
      recentOrderEmails(ctx.tenantId, since),
    ])
    const mine = [...waiting.map((r) => asSample(String(r._id), 'waiting', r.rawPayload)), ...orders.map((r) => asSample(String(r._id), 'order', r.rawPayload))]
      .filter((s): s is SampleEmail => s !== null && listsSender(senders, senderAddress(s.from)) && s.body !== normaliseBody(input.sample))
      .slice(0, 12)
    for (const s of mine) out.push(run(s.id, s))
  }
  return { rows: out }
}

export async function saveLayout(input: {
  key: string | null
  name: string
  source: string
  senders: string[]
  requireVerified: boolean
  rules: unknown
  sample: string
  sampleReceivedAt: string | null
}): Promise<{ error?: string; key?: string }> {
  const ctx = await requirePermission('company.manage')
  const name = input.name.trim().slice(0, 80)
  if (!name) return { error: 'Give this layout a name, like "TrainBites orders".' }
  let rules
  try {
    rules = validateRules(input.rules)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const senders = [...new Set(input.senders.map((s) => normaliseSenderEntry(s)).filter((s): s is string => s !== null))]
  if (senders.length === 0) return { error: 'Add the email address these orders come from. Only mail from it will be read.' }
  const publicDomain = senders.find((s) => /^@(gmail|yahoo|outlook|hotmail|rediffmail|icloud)\.com$/.test(s))
  if (publicDomain) return { error: `${publicDomain} is a public mail service. List the exact address instead.` }
  const source: OrderSource = (ORDER_SOURCES as readonly string[]).includes(input.source) && input.source !== 'MANUAL' ? (input.source as OrderSource) : 'OTHER'
  const check = runTemplate(input.sample, rules, source, input.sampleReceivedAt ? new Date(input.sampleReceivedAt) : new Date())
  if (!check.ok && check.reason !== 'MISSING_FIELD') return { error: `It does not read its own email yet: ${check.detail.replace(' (taught layout)', '')}.` }

  await connectDb()
  const doc = {
    name, source, senders, requireVerified: input.requireVerified, rules,
    sampleBody: normaliseBody(input.sample), sampleReceivedAt: input.sampleReceivedAt ? new Date(input.sampleReceivedAt) : null,
    updatedById: ctx.userId,
  }
  if (input.key) {
    const r = await MailSource.updateOne({ tenantId: ctx.tenantId, key: input.key, kind: 'TAUGHT' }, { $set: doc })
    if (!r.matchedCount) return { error: 'That layout no longer exists.' }
    revalidatePath(V2)
    return { key: input.key }
  }
  const key = `T:${randomUUID().slice(0, 8)}`
  await MailSource.create({ tenantId: ctx.tenantId, key, kind: 'TAUGHT', active: true, ...doc })
  revalidatePath(V2)
  return { key }
}

export async function loadLayout(key: string) {
  const ctx = await requirePermission('company.manage')
  await connectDb()
  const r = await MailSource.findOne({ tenantId: ctx.tenantId, key, kind: 'TAUGHT' }).lean()
  if (!r) return null
  return {
    key: r.key, name: r.name, source: r.source ?? 'OTHER', senders: r.senders ?? [], requireVerified: Boolean(r.requireVerified),
    rules: r.rules, sample: r.sampleBody ?? '', sampleReceivedAt: r.sampleReceivedAt ? new Date(r.sampleReceivedAt).toISOString() : null,
  }
}

export async function sourceChoices(): Promise<{ id: string; label: string }[]> {
  await requirePermission('company.manage')
  return ORDER_SOURCES.filter((s) => s !== 'MANUAL').map((s) => ({ id: s, label: SOURCE_LABEL[s] }))
}
