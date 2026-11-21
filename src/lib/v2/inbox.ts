import type { AuthContext } from '@/lib/authContext'
import { UnparsedInbox, User } from '@/lib/models'
import { connectDb } from '@/lib/db'
import { formatIST } from '@/lib/format'
import { toParseableText } from '@/lib/ingest/gmail/client'
import { sourceLabel } from '@/lib/orderEnums'
import { INBOX_REASONS, inboxQuery, previewOf, splitSender, type InboxFilter, type InboxReason, type InboxResolution } from '@/lib/inbox'

/**
 * Reads for the v2 inbox page. The unparsed inbox has no list function in
 * `inboxRepo` (that file owns the writes), so the page's queries live here,
 * shaped for the screen: one row view, the counts the tabs and chips show,
 * and the sender list for the filter.
 */

export { REASON_SHORT, resolutionLabel } from './inboxShared'
export type { InboxRow } from './inboxShared'
import type { InboxRow } from './inboxShared'

export async function loadInboxPage(ctx: AuthContext, filter: InboxFilter, paging: { skip: number; pageSize: number }) {
  await connectDb()
  const tenantId = ctx.tenantId
  const query = { ...inboxQuery(filter), tenantId }
  const [rows, total, openCount, reasonCounts, sources, senders] = await Promise.all([
    UnparsedInbox.find(query).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    UnparsedInbox.countDocuments(query),
    UnparsedInbox.countDocuments({ tenantId, resolved: false }),
    // Per reason under every other filter: a chip says what clicking it leaves.
    UnparsedInbox.aggregate<{ _id: string; n: number }>([
      { $match: { ...inboxQuery(filter, 'reason'), tenantId } },
      { $group: { _id: '$reason', n: { $sum: 1 } } },
    ]),
    UnparsedInbox.distinct('source', { tenantId, resolved: filter.resolved }),
    UnparsedInbox.aggregate<{ _id: string | null; n: number }>([
      { $match: { tenantId, resolved: filter.resolved } },
      { $group: { _id: '$rawPayload.from', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 200 },
    ]),
  ])

  const resolverIds = [...new Set(rows.map((r) => r.resolvedById).filter(Boolean).map(String))]
  const resolvers = resolverIds.length
    ? new Map((await User.find({ _id: { $in: resolverIds }, tenantId }).select('name').lean()).map((u) => [String(u._id), u.name]))
    : new Map<string, string>()

  const view: InboxRow[] = rows.map((row) => {
    const payload = (row.rawPayload ?? {}) as { body?: string; subject?: string | null; from?: string | null }
    const sender = splitSender(payload.from)
    const partial = (row.partial && typeof row.partial === 'object' ? row.partial : {}) as Record<string, unknown>
    return {
      id: String(row._id),
      reason: row.reason as InboxReason,
      source: row.source,
      sourceLabel: row.source === 'UNKNOWN' ? 'Unknown sender' : sourceLabel(row.source),
      subject: payload.subject?.trim() || null,
      senderName: sender.name || null,
      senderAddress: sender.address || null,
      preview: previewOf(stripCssRules(toParseableText(stripInvisible(payload.body ?? '')))),
      detail: row.detail ?? null,
      externalOrderId: row.externalOrderId ?? (typeof partial.externalOrderId === 'string' ? partial.externalOrderId : null),
      outletName: typeof partial.outletName === 'string' ? partial.outletName : null,
      partial: summarizePartial(partial),
      createdAt: formatIST(row.createdAt),
      createdAtIso: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      resolved: Boolean(row.resolved),
      resolvedAt: row.resolvedAt ? formatIST(row.resolvedAt) : null,
      resolvedBy: row.resolvedById ? (resolvers.get(String(row.resolvedById)) ?? 'A removed user') : null,
      resolution: (row.resolution as InboxResolution | null) ?? (row.resolvedOrderId ? 'ORDER' : null),
      resolvedOrderId: row.resolvedOrderId ? String(row.resolvedOrderId) : null,
      bulkActionCount: row.bulkActionCount ?? null,
    }
  })

  // One entry per address, however many display names it was sent under.
  const senderCounts = new Map<string, { label: string; n: number }>()
  for (const s of senders) {
    const { name, address } = splitSender(s._id)
    if (!address) continue
    const cur = senderCounts.get(address)
    if (cur) cur.n += s.n
    else senderCounts.set(address, { label: name ? `${name} <${address}>` : address, n: s.n })
  }
  const senderOptions = [...senderCounts]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 40)
    .map(([value, { label, n }]) => ({ value, label: `${label} (${n})` }))

  const sourceOptions = sources
    .filter((s): s is string => typeof s === 'string')
    .sort()
    .map((s) => ({ value: s, label: s === 'UNKNOWN' ? 'Unknown (no parser)' : sourceLabel(s) }))

  const byReason = new Map(reasonCounts.map((r) => [r._id, r.n]))
  return {
    rows: view,
    total,
    openCount,
    reasonCounts: INBOX_REASONS.map((r) => ({ reason: r, count: byReason.get(r) ?? 0 })),
    reasonTotal: reasonCounts.reduce((sum, r) => sum + r.n, 0),
    sourceOptions,
    senderOptions,
  }
}

/**
 * Drops the parts of an HTML email a reader never sees. Bank alerts open with
 * a <style> block, and without this the row's preview is a run of CSS rules
 * instead of the first line of the message.
 */
function stripInvisible(body: string): string {
  return body.replace(/<(style|script|head|title)[\s>][\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
}

/**
 * Bodies stored by ingestion were already flattened to text, with any
 * <style> block's rules left in place as the first "paragraph". A run of
 * `selector { declarations }` is never the message, so the preview skips it.
 */
function stripCssRules(text: string): string {
  let out = text
  // Innermost first, so a @media shell empties and then goes too.
  for (let pass = 0; pass < 4; pass++) {
    const next = out
      .replace(/(?:^|\n)\s*(?:[^{}\n]{1,200}\{[^{}]*:[^{}]*\}\s*){2,}/g, '\n')
      .replace(/@[a-z-]+[^{}\n]{0,200}\{\s*(?:[^{}\n]{1,200}\{[^{}]*:[^{}]*\}\s*)*\}/g, '')
    if (next === out) break
    out = next
  }
  return out.trim()
}

/** What the parser did understand, as label/value pairs for the drawer. */
function summarizePartial(p: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const add = (label: string, v: unknown) => {
    if (v === null || v === undefined || v === '' || typeof v === 'object') return
    out.push({ label, value: String(v) })
  }
  add('Order id', p.externalOrderId)
  add('Outlet', p.outletName)
  add('Station', p.stationCode ?? p.stationName)
  add('Train', [p.trainNo, p.trainName].filter(Boolean).join(' ') || null)
  add('Passenger', p.contactName)
  add('Phone', p.contactPhone)
  add('Seat', [p.coach, p.berth].filter(Boolean).join(' / ') || p.rawSeat || null)
  add('Amount', typeof p.amountPaise === 'number' ? `₹${(p.amountPaise / 100).toFixed(2)}` : null)
  add('Payment', p.paymentMode)
  if (Array.isArray(p.items) && p.items.length) {
    const items = p.items as { name?: string; qty?: number }[]
    add('Items', items.slice(0, 6).map((i) => `${i.qty ?? 1} × ${i.name ?? '?'}`).join(', ') + (items.length > 6 ? ` +${items.length - 6} more` : ''))
  }
  return out
}
