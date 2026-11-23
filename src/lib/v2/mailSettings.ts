import type { Types } from 'mongoose'
import { connectDb } from '../db'
import { GMAIL_STATE_ID, IngestState, MailSource, Payment, UnparsedInbox } from '../models'
import { orderSendersSince } from '../repo/mailSourceRepo'
import { PARSERS } from '../ingest'
import { PAYMENT_PARSERS } from '../ingest/payments'
import { senderAddress } from '../ingest/senders'
import { listsSender } from '../ingest/mailSources'
import { SOURCE_LABEL, type OrderSource } from '../orderEnums'
import { tenantKey } from '../tenancy/primary'

/**
 * Settings → Order emails: every source a company's orders can arrive from,
 * the senders listed for each, and the senders that actually sent orders
 * lately, so listing them is one tap instead of guesswork.
 */

export type SourceView = {
  key: string
  kind: 'BUILTIN' | 'PAYMENT' | 'TAUGHT'
  id: string | null
  name: string
  source: string | null
  senders: string[]
  requireVerified: boolean
  active: boolean
  /** Senders seen on this source's orders in the last 90 days, not yet listed. */
  suggestions: { address: string; count: number; verified: number }[]
  /** Orders (or payments) in the last 90 days. */
  recent: number
  updatedAt: string | null
}

export type MailSettings = {
  enforce: boolean
  legacy: string[]
  sources: SourceView[]
  /** Sources that had orders lately but list no sender: they would stop. */
  unlisted: string[]
}

/** The built-in readers, one row per aggregator (some have two readers). */
export function builtinKeys(): { key: string; name: string; source: string | null; kind: 'BUILTIN' | 'PAYMENT' }[] {
  const seen = new Set<string>()
  const out: { key: string; name: string; source: string | null; kind: 'BUILTIN' | 'PAYMENT' }[] = []
  for (const p of PARSERS) {
    if (seen.has(p.source)) continue
    seen.add(p.source)
    out.push({ key: p.source, name: SOURCE_LABEL[p.source] ?? p.source, source: p.source, kind: 'BUILTIN' })
  }
  for (const p of PAYMENT_PARSERS) out.push({ key: `PAY:${p.provider}`, name: `${p.provider[0]}${p.provider.slice(1).toLowerCase()} bank alerts`, source: null, kind: 'PAYMENT' })
  return out
}

type Seen = Map<string, Map<string, { count: number; verified: number }>>

function tally(into: Seen, key: string, from: unknown, verified: unknown, count: number) {
  const address = senderAddress(typeof from === 'string' ? from : null)
  if (!address) return
  const m = into.get(key) ?? new Map()
  const cur = m.get(address) ?? { count: 0, verified: 0 }
  cur.count += count
  if (verified === true) cur.verified += count
  m.set(address, cur)
  into.set(key, m)
}

export async function loadMailSettings(tenantId: Types.ObjectId): Promise<MailSettings> {
  await connectDb()
  const since = new Date(Date.now() - 90 * 24 * 3_600_000)
  const [state, rows, orderSenders, paySenders, waitingSenders] = await Promise.all([
    IngestState.findOne({ _id: await tenantKey(tenantId, GMAIL_STATE_ID), tenantId }).select('allowedSenders enforceSenders').lean(),
    MailSource.find({ tenantId }).sort({ kind: 1, name: 1 }).lean(),
    orderSendersSince(tenantId, since),
    Payment.aggregate<{ _id: { provider: string; from: string | null; v: boolean | null }; n: number }>([
      { $match: { tenantId, createdAt: { $gte: since }, 'rawPayload.from': { $type: 'string' } } },
      { $group: { _id: { provider: '$provider', from: '$rawPayload.from', v: '$rawPayload.auth.verified' }, n: { $sum: 1 } } },
      { $limit: 500 },
    ]),
    // Mail held back for an unknown sender is a suggestion too: it is often
    // the very first order from a new address.
    UnparsedInbox.aggregate<{ _id: { source: string; from: string | null; v: boolean | null }; n: number }>([
      { $match: { tenantId, resolved: false, reason: 'SENDER_NOT_TRUSTED', createdAt: { $gte: since } } },
      { $group: { _id: { source: '$source', from: '$rawPayload.from', v: '$rawPayload.auth.verified' }, n: { $sum: 1 } } },
      { $limit: 500 },
    ]),
  ])

  const seen: Seen = new Map()
  const recent = new Map<string, number>()
  for (const r of orderSenders) {
    tally(seen, r._id.source, r._id.from, r._id.v, r.n)
    recent.set(r._id.source, (recent.get(r._id.source) ?? 0) + r.n)
  }
  for (const r of paySenders) {
    tally(seen, `PAY:${r._id.provider}`, r._id.from, r._id.v, r.n)
    recent.set(`PAY:${r._id.provider}`, (recent.get(`PAY:${r._id.provider}`) ?? 0) + r.n)
  }
  for (const r of waitingSenders) {
    const key = PAYMENT_PARSERS.some((p) => p.provider === r._id.source) ? `PAY:${r._id.source}` : r._id.source
    tally(seen, key, r._id.from, r._id.v, r.n)
  }

  const byKey = new Map(rows.map((r) => [r.key, r]))
  const views: SourceView[] = []
  const suggestFor = (key: string, senders: string[]) =>
    [...(seen.get(key) ?? new Map()).entries()]
      .filter(([a]) => !listsSender(senders, a))
      .map(([address, v]) => ({ address, count: v.count, verified: v.verified }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)

  for (const b of builtinKeys()) {
    const r = byKey.get(b.key)
    const senders = r?.senders ?? []
    views.push({
      key: b.key, kind: b.kind, id: r ? String(r._id) : null, name: b.name, source: b.source, senders,
      requireVerified: Boolean(r?.requireVerified), active: r?.active !== false,
      suggestions: suggestFor(b.key, senders), recent: recent.get(b.key) ?? 0,
      updatedAt: r?.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    })
  }
  for (const r of rows) {
    if (r.kind !== 'TAUGHT') continue
    views.push({
      key: r.key, kind: 'TAUGHT', id: String(r._id), name: r.name, source: r.source ?? 'OTHER', senders: r.senders ?? [],
      requireVerified: Boolean(r.requireVerified), active: r.active !== false, suggestions: [],
      recent: 0, updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    })
  }

  // Taught layouts file orders under their source too; count them apart is
  // not possible, so the source's count stands for both.
  const unlisted = views.filter((v) => v.kind !== 'TAUGHT' && v.recent > 0 && v.senders.length === 0).map((v) => v.name)

  return { enforce: state?.enforceSenders === true, legacy: [...(state?.allowedSenders ?? [])].sort(), sources: views, unlisted }
}

export function isBuiltinKey(key: string): { kind: 'BUILTIN' | 'PAYMENT'; name: string; source: string | null } | null {
  const b = builtinKeys().find((x) => x.key === key)
  return b ? { kind: b.kind, name: b.name, source: b.source } : null
}

export type { OrderSource }
