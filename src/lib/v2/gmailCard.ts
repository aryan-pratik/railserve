import type { GmailCardData } from '@/components/v2/GmailLinkCard'
import { mailboxOf } from '@/lib/repo/mailboxRepo'
import { isGmailConfigured } from '@/lib/ingest/gmail/client'
import { getPrimaryTenantId } from '@/lib/tenancy/primary'
import { LINK_ERRORS, type LinkFrom } from '@/lib/gmailLink'

function ago(d: Date, now = Date.now()): string {
  const m = Math.round((now - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  const days = Math.round(h / 24)
  return `${days} days ago`
}

/** Everything the "Your Gmail" card shows, for one company, after any return trip through Google. */
export async function gmailCardData(tenantId: string, from: LinkFrom, query: { gmail?: string; reason?: string }): Promise<GmailCardData> {
  const [m, primaryId] = await Promise.all([mailboxOf(tenantId), getPrimaryTenantId()])
  const banner =
    query.gmail === 'linked' && m
      ? { tone: 'ok' as const, text: `Gmail linked: ${m.email}. Orders arriving there will now appear in RailServe within a minute.` }
      : query.gmail === 'error'
        ? { tone: 'bad' as const, text: LINK_ERRORS[query.reason ?? ''] ?? LINK_ERRORS.failed }
        : null
  return {
    linked: m ? { email: m.email, linkedAt: m.linkedAt.toISOString(), foundAtLink: m.foundAtLink, lastError: m.lastError, lastMessageAgo: m.lastMessageAt ? ago(m.lastMessageAt) : null } : null,
    serverMailbox: !m && String(primaryId) === tenantId && isGmailConfigured(),
    banner,
    linkHref: `/api/gmail/link/start?from=${from}`,
    // Unlinking leaves a company with no orders from email; during joining
    // there is nothing to unlink to, so only Change is offered there.
    canUnlink: from === 'settings',
  }
}
