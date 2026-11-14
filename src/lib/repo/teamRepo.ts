import mongoose from 'mongoose'
import { User } from '../models'
import { connectDb } from '../db'
import { ConflictError, ForbiddenError, type AuthContext } from '../authContext'
import { canReceiveCash } from '../collections'
import { opsDayOf, opsDayRange } from '../opsDay'
import { NO_RIDER_DAY, NO_RIDER_NOW, riderDays, ridersNow, type RiderDay, type RiderNow } from './riderLedgerRepo'
import {
  collectionHistory, pendingCashByRider, pendingCashOrders, receiversOf, type PendingCash, type PendingCashOrder,
} from './riderCashRepo'

/**
 * Rider teams: a team leader and the riders an admin has put under them.
 *
 * A team is not a document. It is the set of riders whose `teamLeadId` names
 * the same leader, so there is nothing to keep in step: moving a rider is one
 * field, and a leader with nobody under them is simply a leader with an empty
 * team. Only an admin arranges teams.
 */

export type TeamMember = {
  id: string
  name: string
  phone: string
  active: boolean
  isLead: boolean
  day: RiderDay
  now: RiderNow
  /** Delivered COD cash not yet received from this rider, across all days. */
  due: { paise: number; orders: number; orderIds: string[] }
  /** The orders that cash is on, oldest first, for receiving one at a time. */
  dueOrders: Omit<PendingCashOrder, 'riderId'>[]
  lastCollection: { at: string; paise: number; orders: number; receivedBy: string | null } | null
}

export type TeamView = {
  day: string
  lead: { id: string; name: string; phone: string; canReceiveCash: boolean }
  members: TeamMember[]
  /** The team's recent handovers, newest first: who handed in what, to whom. */
  collections: {
    id: string
    riderId: string
    riderName: string
    at: string
    paise: number
    orders: number
    receivedBy: string | null
    receivedAs: string | null
  }[]
}

const NO_DUE: PendingCash = { paise: 0, orders: 0, orderIds: [] }

/** The ids a team leader may read: their own, and their riders'. Empty for anyone who leads nobody. */
export async function teamRiderIds(leadId: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId[]> {
  await connectDb()
  const members = await User.find({ role: 'DELIVERY_AGENT', teamLeadId: leadId }).select('_id').lean()
  return members.map((m) => m._id)
}

/**
 * One team's day: every rider under the leader, and the leader themselves
 * (who also carries orders), with the same figures each rider sees in their
 * own app, because they come from the same ledger.
 *
 * Callable by the leader for their own team and by an admin for any team.
 * The order reads go through the caller's outlets, so a leader whose rider
 * also works an outlet the leader does not is shown only the shared part.
 */
export async function teamView(
  ctx: AuthContext,
  leadId: mongoose.Types.ObjectId,
  opts: { day?: string; now?: Date } = {},
): Promise<TeamView> {
  if (ctx.role !== 'ADMIN' && !(ctx.role === 'DELIVERY_AGENT' && ctx.userId.equals(leadId))) {
    throw new ForbiddenError('Only the team leader or an admin may read a team')
  }
  await connectDb()
  const lead = await User.findOne({ _id: leadId, role: 'DELIVERY_AGENT', isTeamLead: true })
    .select('name phone active isTeamLead canReceiveCash role')
    .lean()
  if (!lead) throw new ForbiddenError('You are not a team leader')

  const riders = await User.find({ role: 'DELIVERY_AGENT', teamLeadId: leadId })
    .select('name phone active')
    .sort({ active: -1, name: 1 })
    .lean()
  const people = [{ ...lead, isLead: true }, ...riders.map((r) => ({ ...r, isLead: false }))]
  const ids = people.map((p) => p._id)

  const day = opts.day ?? opsDayOf(opts.now)
  const range = opsDayRange(day) ?? opsDayRange(opsDayOf(opts.now))!
  const [days, nows, dues, dueOrders, collections, recent] = await Promise.all([
    riderDays(ctx, ids, range),
    ridersNow(ctx, ids),
    pendingCashByRider(ctx, ids),
    pendingCashOrders(ctx, ids),
    collectionHistory(ctx, ids, { latestPerRider: true }),
    collectionHistory(ctx, ids, { limit: 60 }),
  ])
  const receivers = await receiversOf([...collections, ...recent])
  const nameOf = new Map(people.map((p) => [String(p._id), p.name]))

  return {
    day,
    lead: {
      id: String(lead._id),
      name: lead.name,
      phone: lead.phone,
      canReceiveCash: canReceiveCash({ role: 'DELIVERY_AGENT', isTeamLead: true, canReceiveCash: lead.canReceiveCash }),
    },
    members: people.map((p) => {
      const id = String(p._id)
      const last = collections.find((c) => c.riderId === id)
      return {
        id,
        name: p.name,
        phone: p.phone,
        active: p.active !== false,
        isLead: p.isLead,
        day: days.get(id) ?? NO_RIDER_DAY,
        now: nows.get(id) ?? NO_RIDER_NOW,
        due: dues.get(id) ?? NO_DUE,
        dueOrders: dueOrders
          .filter((o) => o.riderId === id)
          .map((o) => ({
            id: o.id,
            externalOrderId: o.externalOrderId,
            trainNo: o.trainNo,
            contactName: o.contactName,
            paise: o.paise,
            deliveredAt: o.deliveredAt,
          })),
        lastCollection: last
          ? {
              at: last.at,
              paise: last.paise,
              orders: last.orders,
              receivedBy: last.receivedById ? (receivers.get(last.receivedById)?.name ?? null) : null,
            }
          : null,
      }
    }),
    collections: recent.map((c) => ({
      id: c.id,
      riderId: c.riderId,
      riderName: nameOf.get(c.riderId) ?? 'Rider',
      at: c.at,
      paise: c.paise,
      orders: c.orders,
      receivedBy: c.receivedById ? (receivers.get(c.receivedById)?.name ?? null) : null,
      receivedAs: c.receivedById ? (receivers.get(c.receivedById)?.label ?? null) : null,
    })),
  }
}

/**
 * An admin places riders under a team leader, or takes them out (leadId null).
 *
 * The leader must be an active rider marked as a team leader, and cannot be
 * placed under themselves or under another leader while they lead: a team is
 * one level deep, so "who answers for this rider" always has one answer.
 */
export async function setTeam(params: {
  ctx: AuthContext
  riderIds: string[]
  leadId: string | null
}): Promise<{ moved: number }> {
  const { ctx, leadId } = params
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may arrange rider teams')
  const riderIds = [...new Set(params.riderIds)].filter((id) => mongoose.isValidObjectId(id))
  if (riderIds.length === 0) throw new ConflictError('Choose at least one rider')
  await connectDb()

  if (leadId !== null) {
    if (!mongoose.isValidObjectId(leadId)) throw new ConflictError('Choose a team leader')
    const lead = await User.findOne({ _id: leadId, role: 'DELIVERY_AGENT', isTeamLead: true, active: true })
      .select('_id')
      .lean()
    if (!lead) throw new ConflictError('That person is not an active rider team leader')
    if (riderIds.includes(leadId)) throw new ConflictError('A team leader cannot be on their own team')
    const leaders = await User.countDocuments({ _id: { $in: riderIds }, isTeamLead: true })
    if (leaders > 0) throw new ConflictError('A team leader cannot be placed under another team leader')
  }

  const res = await User.updateMany(
    { _id: { $in: riderIds }, role: 'DELIVERY_AGENT' },
    { $set: { teamLeadId: leadId ? new mongoose.Types.ObjectId(leadId) : null } },
  )
  return { moved: res.modifiedCount }
}
