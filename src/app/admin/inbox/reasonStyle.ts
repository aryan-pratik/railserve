import type { InboxReason } from '@/lib/inbox'

/** One colour per reason, shared by the chips and the rows so they read as a key. */
export const REASON_BADGE: Record<InboxReason, string> = {
  PARSE_FAILED: 'bg-red-50 text-red-700 ring-red-200',
  UNKNOWN_OUTLET: 'bg-amber-50 text-amber-800 ring-amber-200',
  MISSING_FIELD: 'bg-orange-50 text-orange-800 ring-orange-200',
}

export const REASON_DOT: Record<InboxReason, string> = {
  PARSE_FAILED: 'bg-red-500',
  UNKNOWN_OUTLET: 'bg-amber-500',
  MISSING_FIELD: 'bg-orange-500',
}

/** Short enough for a dense row. */
export const REASON_SHORT: Record<InboxReason, string> = {
  PARSE_FAILED: 'No parser',
  UNKNOWN_OUTLET: 'Unknown outlet',
  MISSING_FIELD: 'Field missing',
}
