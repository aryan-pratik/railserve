import type { Types } from 'mongoose'
import { MailSource } from '../models'
import type { MailAuth } from './mailAuth'
import type { TemplateRules } from './templates/types'

/**
 * A company's mail sources, as ingestion reads them. See models/MailSource.ts.
 */
export type MailSourceRow = {
  id: string
  key: string
  kind: 'BUILTIN' | 'PAYMENT' | 'TAUGHT'
  name: string
  source: string | null
  senders: string[]
  requireVerified: boolean
  active: boolean
  rules: TemplateRules | null
}

export async function loadMailSources(tenantId: Types.ObjectId): Promise<MailSourceRow[]> {
  const rows = await MailSource.find({ tenantId }).select('key kind name source senders requireVerified active rules').lean()
  return rows.map((r) => ({
    id: String(r._id),
    key: r.key,
    kind: r.kind as MailSourceRow['kind'],
    name: r.name,
    source: r.source ?? null,
    senders: r.senders ?? [],
    requireVerified: Boolean(r.requireVerified),
    active: r.active !== false,
    rules: (r.rules as TemplateRules | null) ?? null,
  }))
}

/** Whether an address is on a list of addresses and `@domain`s. */
export function listsSender(entries: readonly string[], address: string | null): boolean {
  if (!address) return false
  const domain = address.slice(address.indexOf('@'))
  return entries.some((e) => e === address || e === domain)
}

/**
 * Whether a source accepts this mail. The reason, when it does not, is shown
 * to the admin on the waiting email, in plain words.
 */
export function trustFor(
  row: MailSourceRow | undefined,
  label: string,
  address: string | null,
  auth: MailAuth | null,
): { ok: true } | { ok: false; why: string } {
  const who = address ?? 'an unreadable sender'
  if (!row || row.senders.length === 0) return { ok: false, why: `Looks like a ${label} email, but no sender is listed for ${label} yet. It came from ${who}.` }
  if (!row.active) return { ok: false, why: `${label} is switched off in Settings → Order emails.` }
  if (!listsSender(row.senders, address)) return { ok: false, why: `Looks like a ${label} email, but it came from ${who}, which is not on ${label}'s sender list.` }
  if (row.requireVerified && !auth?.verified) {
    return { ok: false, why: `Came from ${who}, but Gmail could not confirm it really came from there.` }
  }
  return { ok: true }
}
