/**
 * The admin inbox's filters, as plain data.
 *
 * One parser for both the page's searchParams and the bulk form's fields, so
 * "select all 240 matching" acts on exactly the rows the admin is looking at
 * and nothing the screen did not show. Pure, so the tests read it without a
 * database.
 */

import { istDaysToRange } from './activity'

export const INBOX_REASONS = ['PARSE_FAILED', 'UNKNOWN_OUTLET', 'MISSING_FIELD'] as const
export type InboxReason = (typeof INBOX_REASONS)[number]

export const REASON_LABEL: Record<InboxReason, string> = {
  PARSE_FAILED: 'Could not parse',
  UNKNOWN_OUTLET: 'Outlet not recognised',
  MISSING_FIELD: 'Field missing',
}

export const INBOX_RESOLUTIONS = ['ORDER', 'PAYMENT', 'DISMISSED'] as const
export type InboxResolution = (typeof INBOX_RESOLUTIONS)[number]

/** The most rows one "re-ingest all matching" click works through. */
export const BULK_REINGEST_LIMIT = 200

export type InboxFilter = {
  resolved: boolean
  reason: InboxReason | null
  /** The parser that claimed the email, or UNKNOWN. */
  source: string | null
  /** A sender address; matched against the stored From header. */
  sender: string | null
  /** Free text over subject, sender, body, detail and order id. */
  q: string
  /** IST days, YYYY-MM-DD. */
  from: string | null
  to: string | null
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams | FormData

const DAY = /^\d{4}-\d{2}-\d{2}$/

function getter(p: Params): (key: string) => string {
  if (p instanceof URLSearchParams || p instanceof FormData) {
    return (key) => {
      const v = p.get(key)
      return typeof v === 'string' ? v.trim() : ''
    }
  }
  return (key) => {
    const v = p[key]
    return ((Array.isArray(v) ? v[0] : v) ?? '').trim()
  }
}

export function readInboxFilter(p: Params): InboxFilter {
  const get = getter(p)
  const reason = get('reason')
  let from = DAY.test(get('from')) ? get('from') : null
  let to = DAY.test(get('to')) ? get('to') : null
  if (from && to && to < from) [from, to] = [to, from]
  return {
    resolved: get('show') === 'resolved',
    reason: (INBOX_REASONS as readonly string[]).includes(reason) ? (reason as InboxReason) : null,
    source: get('source') || null,
    sender: get('sender').toLowerCase() || null,
    q: get('q').slice(0, 200),
    from,
    to,
  }
}

/** The filter back as URL params, leaving out what is at its default. */
export function inboxFilterParams(f: InboxFilter): URLSearchParams {
  const u = new URLSearchParams()
  if (f.resolved) u.set('show', 'resolved')
  if (f.q) u.set('q', f.q)
  if (f.reason) u.set('reason', f.reason)
  if (f.source) u.set('source', f.source)
  if (f.sender) u.set('sender', f.sender)
  if (f.from) u.set('from', f.from)
  if (f.to) u.set('to', f.to)
  return u
}

/** Is anything narrowing the list beyond the tab? */
export function isFiltered(f: InboxFilter): boolean {
  return Boolean(f.reason || f.source || f.sender || f.q || f.from || f.to)
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The Mongo filter for an InboxFilter. `omit` drops one field, so the reason
 * chips can count every reason under the other filters.
 */
export function inboxQuery(f: InboxFilter, omit?: 'reason'): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ resolved: f.resolved }]
  if (f.reason && omit !== 'reason') and.push({ reason: f.reason })
  if (f.source) and.push({ source: f.source })
  if (f.sender) and.push({ 'rawPayload.from': { $regex: escapeRegex(f.sender), $options: 'i' } })
  if (f.from || f.to) {
    const range = istDaysToRange(f.from ?? f.to!, f.to ?? f.from!)
    const createdAt: Record<string, Date> = {}
    if (f.from) createdAt.$gte = range.from
    if (f.to) createdAt.$lt = range.to
    and.push({ createdAt })
  }
  if (f.q) {
    const rx = { $regex: escapeRegex(f.q.replace(/^\s*#\s*/, '')), $options: 'i' }
    and.push({
      $or: [
        { 'rawPayload.subject': rx },
        { 'rawPayload.from': rx },
        { 'rawPayload.body': rx },
        { detail: rx },
        { externalOrderId: rx },
        { source: rx },
      ],
    })
  }
  return and.length === 1 ? and[0] : { $and: and }
}

/**
 * A one-line preview of an email body: markup, entities and runs of
 * whitespace and punctuation stripped, so the row says something a person can
 * read at a glance instead of `<html><head><style>`.
 */
export function previewOf(body: string | null | undefined, max = 160): string {
  if (!body) return ''
  const text = body
    .slice(0, 20_000)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#?\w+;/g, ' ')
    .replace(/[*_=~-]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** "Zoop Orders <orders@zoop.in>" → { name: "Zoop Orders", address: "orders@zoop.in" } */
export function splitSender(from: string | null | undefined): { name: string; address: string } {
  const raw = (from ?? '').trim()
  if (!raw) return { name: '', address: '' }
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() }
  return { name: '', address: raw.toLowerCase() }
}
