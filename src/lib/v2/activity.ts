import { readKind, readPanel, type ActivityKind, type ActivityPanel } from '@/lib/activity'
import type { ActivityEntry } from '@/lib/repo/activityRepo'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { todayIST, formatMoney } from '@/lib/format'
import { formatLoggedValue, itemField, orderField } from '@/lib/orderEditFields'
import { statusChip } from '@/components/v2/ui'

/*
 * The v2 Activity feed: what the URL means, and how one entry reads as a
 * sentence. The query itself is activityRepo.activityFeed.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/

export type ActivityParams = {
  mode: DateFilterMode
  month: string
  rawFrom: string
  rawTo: string
  /** The resolved, always-bounded IST days. */
  fromDay: string
  toDay: string
  panel: ActivityPanel | null
  panelParam: string
  kind: ActivityKind | null
  kindParam: string
  person: string
  orderId: string
  q: string
  station: string
}

type Params = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/**
 * Reads the feed's filters. Always bounded by date and opens on today: a log
 * without a bound is every event ever written, unwound on every page load.
 */
export function readActivityParams(sp: Params): ActivityParams {
  const rawMode = one(sp.mode)
  const mode = (rawMode && rawMode !== 'all' ? rawMode : 'today') as DateFilterMode
  const month = one(sp.month)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  // A half-picked custom range still means something: one end alone is that
  // day, and an end before its start is read the right way round.
  const today = todayIST()
  const resolved = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })
  let fromDay = DAY.test(resolved.from) ? resolved.from : DAY.test(resolved.to) ? resolved.to : today
  let toDay = DAY.test(resolved.to) ? resolved.to : DAY.test(resolved.from) ? today : fromDay
  if (toDay < fromDay) [fromDay, toDay] = [toDay, fromDay]

  const panelParam = one(sp.panel)
  const kindParam = one(sp.kind)
  return {
    mode,
    month,
    rawFrom,
    rawTo,
    fromDay,
    toDay,
    panel: readPanel(panelParam),
    panelParam,
    kind: readKind(kindParam),
    kindParam,
    person: one(sp.person),
    orderId: one(sp.orderId).trim(),
    q: one(sp.q).trim(),
    station: one(sp.station).trim().toUpperCase(),
  }
}

type Carried = Partial<Record<'mode' | 'month' | 'from' | 'to' | 'panel' | 'kind' | 'person' | 'orderId' | 'q' | 'station', string>>

/** This page with the filters changed; blank values are left out. */
export function activityHref(p: ActivityParams, over: Carried = {}, paging?: { page: number; pageSize: number }): string {
  const current: Carried = {
    mode: p.mode === 'today' ? '' : p.mode,
    month: p.mode === 'custom-month' ? p.month : '',
    from: p.mode === 'range' ? p.rawFrom : '',
    to: p.mode === 'range' ? p.rawTo : '',
    panel: p.panel ? p.panelParam : '',
    kind: p.kind ? p.kindParam : '',
    person: p.person,
    orderId: p.orderId,
    q: p.q,
    station: p.station,
  }
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...current, ...over })) if (v) u.set(k, v)
  if (paging) {
    if (paging.page > 1) u.set('page', String(paging.page))
    if (paging.pageSize !== 20) u.set('pageSize', String(paging.pageSize))
  }
  const qs = u.toString()
  return `/v2/activity${qs ? `?${qs}` : ''}`
}

export function hasActivityFilters(p: ActivityParams): boolean {
  return Boolean(p.kind || p.person || p.orderId || p.q || p.station)
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * One entry as a sentence: the verb after the actor's name, an optional
 * status move drawn as chips, a line of detail, and the reason given.
 * "old → new" is one string per side so the feed can strike the old one.
 */
export type Sentence = {
  verb: string
  move?: { from: string | null; to: string }
  change?: { label: string; from: string; to: string }
  detail?: string | null
  reason: string | null
}

export function describeEntry(row: ActivityEntry, names: Map<string, string>): Sentence {
  const meta = row.meta ?? {}
  const action = typeof meta.action === 'string' ? meta.action : null
  const reason = str(meta.reason)
  const riders = (ids: unknown) =>
    Array.isArray(ids) && ids.length > 0 ? ids.map((id) => names.get(String(id)) ?? 'an unknown rider').join(', ') : 'nobody'

  if (row.type === 'note') return { verb: 'left a call note', reason: null }

  switch (row.kind) {
    case 'CREATED':
      return { verb: `created the order as ${statusChip(row.toStatus).label.toLowerCase()}`, reason }
    case 'STATUS':
      return { verb: 'moved it', move: { from: row.fromStatus, to: row.toStatus }, reason }
    case 'CANCEL_REQUEST':
      if (action === 'CANCEL_REQUESTED') return { verb: 'asked for it to be cancelled', reason }
      if (action === 'CANCEL_REFUSED') return { verb: 'refused the cancel request', reason }
      return { verb: 'accepted the cancel request', move: { from: row.fromStatus, to: row.toStatus }, reason }
    case 'ASSIGN':
      if (!Array.isArray(meta.fromAgentIds)) return { verb: `put ${riders(meta.agentIds)} on it`, reason }
      return { verb: 'changed the riders', change: { label: 'Riders', from: riders(meta.fromAgentIds), to: riders(meta.agentIds) }, reason }
    case 'CASH': {
      const rider = names.get(String(meta.riderId)) ?? 'the rider'
      const handover =
        typeof meta.handoverOrders === 'number' && meta.handoverOrders > 1
          ? ` (one of ${meta.handoverOrders} orders, ${formatMoney(meta.handoverPaise as number)} in all)`
          : ''
      return { verb: `took ${formatMoney(typeof meta.amountPaise === 'number' ? meta.amountPaise : null)} cash from ${rider}${handover}`, reason }
    }
    case 'RETURN':
      return { verb: `took the bag back from ${riders(meta.riderIds) === 'nobody' ? 'the rider' : riders(meta.riderIds)} at the outlet`, detail: str(meta.note), reason }
    case 'ALERT': {
      const parts = [
        str(meta.trainNo) ? `train ${meta.trainNo}` : null,
        str(meta.platform) ? `platform ${meta.platform}` : null,
        typeof meta.delayMinutes === 'number' && meta.delayMinutes > 0 ? `${meta.delayMinutes} min late` : null,
      ].filter(Boolean)
      return { verb: 'sent the leave-now alert', detail: parts.length ? parts.join(' · ') : null, reason }
    }
    case 'CALL_NOTE':
      return { verb: 'left a call note', reason }
    case 'EDIT':
    default: {
      if (action === 'FIELD_EDITED') {
        const def = orderField(String(meta.field))
        const label = def?.label ?? str(meta.label) ?? String(meta.field)
        return { verb: `changed the ${label.toLowerCase()}`, change: { label, from: formatLoggedValue(def, meta.from), to: formatLoggedValue(def, meta.to) }, reason }
      }
      if (action === 'ITEM_EDITED') {
        const def = itemField(String(meta.field))
        const label = `${str(meta.item) ?? 'an item'} · ${(def?.label ?? str(meta.label) ?? String(meta.field)).toLowerCase()}`
        return { verb: 'changed an item', change: { label, from: formatLoggedValue(def, meta.from), to: formatLoggedValue(def, meta.to) }, reason }
      }
      if (action === 'ITEM_ADDED' || action === 'ITEM_REMOVED') {
        const price = typeof meta.pricePaise === 'number' ? ` · ${formatMoney(meta.pricePaise)}` : ''
        const packing = meta.isPacking ? ' (packing)' : ''
        return { verb: `${action === 'ITEM_ADDED' ? 'added' : 'removed'} ${str(meta.item) ?? 'an item'} ×${String(meta.qty ?? 1)}${price}${packing}`, reason }
      }
      return { verb: action ? action.replace(/_/g, ' ').toLowerCase() : 'updated it', reason }
    }
  }
}
