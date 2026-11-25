import mongoose from 'mongoose'
import type { AuthContext } from '@/lib/authContext'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { riderBoard, type RiderBoard, type RiderView } from '@/lib/repo/riderLocationRepo'
import { collectionHistory, pendingCashOrders, receiversOf } from '@/lib/repo/riderCashRepo'
import { canReceiveCash } from '@/lib/collections'
import { opsDayOf } from '@/lib/opsDay'

/*
 * The v2 rider roster: `riderBoard` (positions, the day's ledger, cash due)
 * widened with what the store manager's old Riders page added on top of it:
 * the account itself (active, outlets, team), the exact orders a rider's
 * pending cash sits on, and their last handover. One payload feeds the page's
 * first paint and the 5s poll alike, so the two can never disagree.
 */

export { BOARD_STATUS, BOARD_STATUS_LABEL, boardStatusOf, statusWordOf, STATUS_HEX, STATUS_DOT, maskPhone } from './ridersShared'
export type { BoardStatus } from './ridersShared'

export type DueOrder = {
  id: string
  externalOrderId: string | null
  trainNo: string | null
  contactName: string | null
  paise: number
  partPaidPaise: number
  billPaise: number
  onlinePaise: number
  /** The rider said they got this much less than the bill; still owed. */
  shortPaise: number
  deliveredAt: string | null
}

export type RosterRider = RiderView & {
  active: boolean
  outletIds: string[]
  /** "Ganga Galaxy · CNB", for the row and the edit dialog. */
  outlets: string[]
  teamLeadName: string | null
  /** Only meaningful on a team leader: whether an admin lets them take their team's cash. */
  canReceiveCash: boolean | null
  /** Delivered COD not yet received, every day, oldest first: what Collect settles. */
  dueOrders: DueOrder[]
  lastHandover: { at: string; paise: number; orders: number; receivedBy: string | null } | null
}

export type RiderRoster = Omit<RiderBoard, 'riders'> & {
  riders: RosterRider[]
  today: string
  isToday: boolean
}

const NO_WORK: RiderView['work'] = {
  carrying: 0, stale: 0, delivered: 0, failed: 0, notDelivered: 0, cancelled: 0, trains: [],
  lastDeliveredAt: null, orders: 0, booked: 0, done: 0, codOrders: 0, codPaise: 0, amountPaise: 0,
  duePaise: 0, dueOrders: 0, earlierDuePaise: 0, earlierDueOrders: 0, stations: [],
}

/** Who a store manager may see: riders at their outlets. An admin sees everyone in the tenant. */
function riderScope(ctx: AuthContext) {
  return ctx.role === 'ADMIN'
    ? { tenantId: ctx.tenantId, role: 'DELIVERY_AGENT' as const }
    : { tenantId: ctx.tenantId, role: 'DELIVERY_AGENT' as const, restaurantIds: { $in: ctx.restaurantIds } }
}

/**
 * The roster for one reporting day. `riderBoard` lists every active rider in
 * the company (it was written for admins); here the list is the caller's:
 * riders attached to their outlets, inactive ones included so they can be
 * switched back on, plus anyone else who did work at those outlets that day,
 * whose cash would otherwise be invisible.
 */
export async function loadRiderRoster(ctx: AuthContext, opts: { serviceDate?: string; now?: Date } = {}): Promise<RiderRoster> {
  const now = opts.now ?? new Date()
  const today = opsDayOf(now)
  const serviceDate = opts.serviceDate ?? today
  await connectDb()

  const [board, accounts, outletDocs] = await Promise.all([
    riderBoard(ctx, { serviceDate, now }),
    User.find(riderScope(ctx)).select('name phone active restaurantIds isTeamLead teamLeadId canReceiveCash').sort({ name: 1 }).lean(),
    Restaurant.find({ tenantId: ctx.tenantId }).select('name stationCode').lean(),
  ])
  const outletLabel = new Map(outletDocs.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))
  const byId = new Map(board.riders.map((r) => [r.id, r]))
  const mine = new Set(accounts.map((a) => String(a._id)))

  // Riders outside the scope who still show work inside it.
  const outsiders = board.riders.filter((r) => {
    if (mine.has(r.id)) return false
    const w = r.work
    return w.carrying > 0 || w.done > 0 || w.booked > 0 || w.duePaise > 0 || w.earlierDuePaise > 0
  })
  const outsiderAccounts = outsiders.length
    ? await User.find({ _id: { $in: outsiders.map((r) => r.id) }, tenantId: ctx.tenantId }).select('name phone active restaurantIds isTeamLead teamLeadId canReceiveCash').lean()
    : []
  const everyone = [...accounts, ...outsiderAccounts]
  const ids = everyone.map((a) => a._id)
  const leadName = new Map(everyone.filter((a) => a.isTeamLead).map((a) => [String(a._id), a.name]))

  const [due, last] = await Promise.all([pendingCashOrders(ctx, ids), collectionHistory(ctx, ids, { latestPerRider: true })])
  const receivers = await receiversOf(ctx, last)
  const lastOf = new Map(last.map((c) => [c.riderId, c]))

  const riders: RosterRider[] = everyone.map((a) => {
    const id = String(a._id)
    const view = byId.get(id)
    const l = lastOf.get(id)
    return {
      id,
      name: a.name,
      phone: a.phone,
      presence: view?.presence ?? 'NEVER',
      position: view?.position ?? null,
      trail: view?.trail ?? [],
      isTeamLead: a.isTeamLead === true,
      teamLeadId: a.teamLeadId ? String(a.teamLeadId) : null,
      work: view?.work ?? NO_WORK,
      active: a.active !== false,
      outletIds: (a.restaurantIds ?? []).map(String),
      outlets: (a.restaurantIds ?? []).map((r) => outletLabel.get(String(r))).filter((x): x is string => Boolean(x)),
      teamLeadName: a.teamLeadId ? (leadName.get(String(a.teamLeadId)) ?? null) : null,
      canReceiveCash: a.canReceiveCash ?? null,
      dueOrders: due
        .filter((o) => o.riderId === id)
        .map((o) => ({ id: o.id, externalOrderId: o.externalOrderId, trainNo: o.trainNo, contactName: o.contactName, paise: o.paise, partPaidPaise: o.partPaidPaise, billPaise: o.billPaise, onlinePaise: o.onlinePaise, shortPaise: o.shortPaise, deliveredAt: o.deliveredAt })),
      lastHandover: l
        ? { at: l.at, paise: l.paise, orders: l.orders, receivedBy: l.receivedById ? (receivers.get(l.receivedById)?.name ?? null) : null }
        : null,
    }
  })

  // Who needs looking at first: reporting now, then carrying the most, then
  // by name; inactive accounts last whatever else is true.
  const rank: Record<RiderView['presence'], number> = { LIVE: 0, IDLE: 1, OFFLINE: 2, NEVER: 3 }
  riders.sort(
    (a, b) =>
      Number(!a.active) - Number(!b.active) ||
      rank[a.presence] - rank[b.presence] ||
      b.work.carrying - a.work.carrying ||
      a.name.localeCompare(b.name),
  )

  const { riders: _dropped, ...rest } = board
  void _dropped
  return { ...rest, riders, today, isToday: serviceDate === today }
}

/** Whether the signed-in person may take cash from riders, read off their record as it is now. */
export async function loadCashReceiver(ctx: AuthContext): Promise<boolean> {
  await connectDb()
  const me = await User.findOne({ _id: ctx.userId, tenantId: ctx.tenantId }).select('role isTeamLead canReceiveCash').lean()
  return canReceiveCash({ role: ctx.role, canReceiveCash: me?.canReceiveCash, isTeamLead: me?.isTeamLead })
}

export type OutletChoice = { id: string; label: string; station: string }

/** The outlets a rider may be attached to from here: the caller's own, or all for an admin. */
export async function loadOutletChoices(ctx: AuthContext): Promise<OutletChoice[]> {
  await connectDb()
  const filter = ctx.role === 'ADMIN'
    ? { tenantId: ctx.tenantId, active: true }
    : { tenantId: ctx.tenantId, _id: { $in: ctx.restaurantIds } }
  const outlets = await Restaurant.find(filter).select('name stationCode').sort({ stationCode: 1, name: 1 }).lean()
  return outlets.map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}`, station: o.stationCode }))
}

/** Active team leaders a rider can be placed under. Only an admin arranges teams. */
export async function loadTeamLeads(ctx: AuthContext): Promise<{ id: string; name: string }[]> {
  if (ctx.role !== 'ADMIN') return []
  await connectDb()
  const leads = await User.find({ tenantId: ctx.tenantId, role: 'DELIVERY_AGENT', isTeamLead: true, active: true }).select('name').sort({ name: 1 }).lean()
  return leads.map((l) => ({ id: String(l._id), name: l.name }))
}

/** True when this caller may open this rider: any rider for an admin, a rider at the caller's outlets otherwise. */
export async function canSeeRider(ctx: AuthContext, riderId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(riderId)) return false
  await connectDb()
  const hit = await User.exists({ _id: riderId, ...riderScope(ctx) })
  return Boolean(hit)
}

/** The ops-day the URL asks for, or today's. Never a day in the future. */
export function readOpsDay(value: string | string[] | undefined, today = opsDayOf()): string {
  const v = Array.isArray(value) ? value[0] : value
  return /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && v! <= today ? v! : today
}
