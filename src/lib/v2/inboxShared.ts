import type { InboxReason, InboxResolution } from '@/lib/inbox'

/*
 * Row shape and labels for the Inbox screens, safe to import from client
 * components. Nothing here may import a repo, a model or the database.
 */

export type InboxRow = {
  id: string
  reason: InboxReason
  source: string
  sourceLabel: string
  subject: string | null
  senderName: string | null
  senderAddress: string | null
  preview: string
  detail: string | null
  externalOrderId: string | null
  /** The outlet name the parser read, when it read one. */
  outletName: string | null
  partial: { label: string; value: string }[]
  createdAt: string
  createdAtIso: string | null
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  resolution: InboxResolution | null
  resolvedOrderId: string | null
  bulkActionCount: number | null
}

export const REASON_SHORT: Record<InboxReason, string> = {
  PARSE_FAILED: 'No parser',
  UNKNOWN_OUTLET: 'Unknown outlet',
  MISSING_FIELD: 'Field missing',
  SENDER_NOT_TRUSTED: 'Unknown sender',
}

export function resolutionLabel(row: Pick<InboxRow, 'resolution'>): string {
  if (row.resolution === 'ORDER') return 'Order created'
  if (row.resolution === 'PAYMENT') return 'Payment recorded'
  if (row.resolution === 'DISMISSED') return 'Dismissed'
  return 'Resolved'
}
