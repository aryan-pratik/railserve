/**
 * The vocabulary of the activity log: which screen an action came from, and
 * what kind of action it was.
 *
 * Nothing here is stored. Every order already carries its own event log and
 * call log, each entry with who did it and, for most, a `via` naming the
 * screen; the activity log is a read across all of them. So both questions
 * are answered from what is already written, and an event recorded before
 * this file existed reads exactly like one recorded after.
 *
 * Pure, so the repository, the pages and the tests read one copy.
 */

import { shiftServiceDate } from './format'

export const ACTIVITY_PANELS = ['ADMIN', 'CALLS', 'STORE', 'RIDER_APP', 'RIDER_WEB', 'SYSTEM'] as const
export type ActivityPanel = (typeof ACTIVITY_PANELS)[number]

export const PANEL_LABEL: Record<ActivityPanel, string> = {
  ADMIN: 'Admin',
  CALLS: 'Call desk',
  STORE: 'Store',
  RIDER_APP: 'Rider app',
  RIDER_WEB: 'Rider web',
  SYSTEM: 'System',
}

/** The URL value for each panel, so a link reads `?panel=rider-app`. */
export const PANEL_PARAM: Record<ActivityPanel, string> = {
  ADMIN: 'admin',
  CALLS: 'calls',
  STORE: 'store',
  RIDER_APP: 'rider-app',
  RIDER_WEB: 'rider-web',
  SYSTEM: 'system',
}

export function readPanel(value: string): ActivityPanel | null {
  return ACTIVITY_PANELS.find((p) => PANEL_PARAM[p] === value) ?? null
}

/** The role whose actions make up each panel. System has none: nobody acted. */
export const PANEL_ROLE: Record<Exclude<ActivityPanel, 'SYSTEM'>, string> = {
  ADMIN: 'ADMIN',
  CALLS: 'TELECALLER',
  STORE: 'STORE_MANAGER',
  RIDER_APP: 'DELIVERY_AGENT',
  RIDER_WEB: 'DELIVERY_AGENT',
}

/**
 * What the rider web page (/agent) tags its writes with. Everything else a
 * rider does comes from the phone app: `expo-app` on its own writes,
 * `rider-correction` on a corrected outcome, and `agent-run` on a run pickup
 * — which the web page also sent until it got `agent-web-run`, so a run
 * picked up on the web before then reads as the app.
 */
export const RIDER_WEB_VIAS = ['agent-order', 'agent-web-run'] as const

/**
 * Which screen an action came from.
 *
 * Role first, `via` second. Every web panel belongs to one role, so the role
 * of whoever acted already names the screen — and many side events
 * (assignments, cash handovers, cancel requests) carry no `via` at all. The
 * one role with two screens is the rider's, and there `via` tells the phone
 * app from the web page (see RIDER_WEB_VIAS). No user at all is the system:
 * email ingest, the train-timing cron.
 *
 * The role is the person's role now, not when they acted: a telecaller since
 * promoted to admin reads as admin on their old work. Roles change rarely
 * enough that recording one on every event was not worth it.
 */
export function panelOf(role: string | null | undefined, via: unknown): ActivityPanel {
  switch (role) {
    case 'ADMIN':
      return 'ADMIN'
    case 'TELECALLER':
      return 'CALLS'
    case 'STORE_MANAGER':
      return 'STORE'
    case 'DELIVERY_AGENT':
      return (RIDER_WEB_VIAS as readonly unknown[]).includes(via) ? 'RIDER_WEB' : 'RIDER_APP'
    default:
      return 'SYSTEM'
  }
}

export const ACTIVITY_KINDS = [
  'CREATED',
  'STATUS',
  'EDIT',
  'ASSIGN',
  'CANCEL_REQUEST',
  'CASH',
  'CALL_NOTE',
  'ALERT',
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export const KIND_LABEL: Record<ActivityKind, string> = {
  CREATED: 'Order created',
  STATUS: 'Status change',
  EDIT: 'Order edited',
  ASSIGN: 'Rider assigned',
  CANCEL_REQUEST: 'Cancel request',
  CASH: 'Cash handover',
  CALL_NOTE: 'Call note',
  ALERT: 'Leave-now alert',
}

export const KIND_PARAM: Record<ActivityKind, string> = {
  CREATED: 'created',
  STATUS: 'status',
  EDIT: 'edit',
  ASSIGN: 'assign',
  CANCEL_REQUEST: 'cancel-request',
  CASH: 'cash',
  CALL_NOTE: 'call-note',
  ALERT: 'alert',
}

export function readKind(value: string): ActivityKind | null {
  return ACTIVITY_KINDS.find((k) => KIND_PARAM[k] === value) ?? null
}

/** The `meta.action` values each side-event kind is made of. */
export const KIND_ACTIONS = {
  EDIT: ['FIELD_EDITED', 'ITEM_EDITED', 'ITEM_ADDED', 'ITEM_REMOVED'],
  ASSIGN: ['ASSIGN_AGENTS', 'ASSIGN_RIDERS'],
  CANCEL_REQUEST: ['CANCEL_REQUESTED', 'CANCEL_REFUSED'],
  CASH: ['COD_SETTLED'],
  ALERT: ['LEAVE_NOW'],
} as const satisfies Partial<Record<ActivityKind, readonly string[]>>

/**
 * What kind of action one order event was.
 *
 * A status change is any event that moved the status; everything else sits
 * on one status (from === to) and says what it was in `meta.action`. An
 * accepted cancel request is a status change — the order did move to
 * Cancelled — but it is filed with the request it answered, so the request
 * and its outcome sit under one filter.
 */
export function kindOf(event: {
  fromStatus?: string | null
  toStatus: string
  meta?: Record<string, unknown> | null
}): ActivityKind {
  const action = typeof event.meta?.action === 'string' ? event.meta.action : null
  if (!event.fromStatus || action === 'CREATED') return 'CREATED'
  if (event.meta?.via === 'cancel-request') return 'CANCEL_REQUEST'
  if (event.fromStatus !== event.toStatus) return 'STATUS'
  for (const [kind, actions] of Object.entries(KIND_ACTIONS)) {
    if (action && (actions as readonly string[]).includes(action)) return kind as ActivityKind
  }
  // An unrecognised side event is still an edit of some sort; filing it
  // under one keeps it findable rather than unfilterable.
  return 'EDIT'
}

/**
 * IST calendar days [from, to], both inclusive, as the [start, end) UTC
 * instants events are stored in.
 */
export function istDaysToRange(from: string, to: string): { from: Date; to: Date } {
  return {
    from: new Date(`${from}T00:00:00+05:30`),
    to: new Date(`${shiftServiceDate(to, 1)}T00:00:00+05:30`),
  }
}
