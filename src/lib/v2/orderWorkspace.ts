import type { AuthContext } from '@/lib/authContext'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { findById, viewCallNotes } from '@/lib/repo/orderRepo'
import { viewCancelRequest, type CancelRequestView } from '@/lib/repo/cancelRequestRepo'
import { mayCollectReturns, viewReturn, type ReturnView } from '@/lib/repo/rtoRepo'
import { listAssignableRiders } from '@/lib/repo/transitionOrder'
import { dietLookupFor } from '@/lib/repo/menuRepo'
import { timingFor, timingForOrders } from '@/lib/train/service'
import { computeDispatchAt, type TimingView } from '@/lib/train/policy'
import { timedByAdmin } from '@/lib/arrival'
import { isMenuDish, tagFor, type Diet } from '@/lib/diet'
import { ROLE_LABEL } from '@/lib/roles'
import { ORDER_EDIT_FIELDS, formatLoggedValue, itemField, orderField } from '@/lib/orderEditFields'
import { sourceLabel } from '@/lib/orderEnums'
import { formatMoney, paiseToRupees, utcToIstLocal } from '@/lib/format'
import { runKeyFor } from '@/lib/runs'
import { env } from '@/lib/env'
import type { CallNoteView } from '@/lib/callNotes'
import { rtoReasonLabel } from '@/lib/rto'

/*
 * Everything the order workspace page reads, in one call, already in the
 * shape its cards want. Dates cross to client components as ISO strings.
 */

export type WorkspaceItem = {
  id: string
  name: string
  qty: number
  pricePaise: number | null
  notes: string | null
  spec: string | null
  isPacking: boolean
  /** The tag stored on the order itself, if any. */
  ownDiet: string | null
  /** The tag the KOT prints with, and whether a person confirmed it. */
  diet: Diet | null
  confirmed: boolean
  /** A thali or combo: the menu cannot name it, so the pencil must. */
  composite: boolean
}

export type WorkspaceRider = { id: string; name: string; phone: string; atOutlet: boolean }

export type JourneyEntry = {
  at: string
  title: string
  detail: string | null
  reason: string | null
  actor: string
  /** The status after this event, for the chip. Null for a side action. */
  toStatus: string | null
}

export type OrderWorkspace = {
  id: string
  externalOrderId: string
  status: string
  orderType: string
  source: string
  sourceLabel: string
  serviceDate: string
  stationCode: string
  outlet: { id: string; name: string; stationCode: string; walkMinutes: number } | null
  outlets: { id: string; label: string }[]
  trainNo: string | null
  trainName: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  handoverPoint: string | null
  pax: number | null
  readyByIso: string | null
  contactName: string | null
  contactPhone: string | null
  amountPaise: number | null
  paymentMode: string | null
  notes: string | null
  remark: string | null
  kotNote: string | null
  pastedText: string | null
  items: WorkspaceItem[]
  timing: TimingView
  /** The booked time when it differs from the one the railway has. */
  bookedIso: string | null
  scheduledIso: string | null
  etaIso: string | null
  leaveByIso: string | null
  runKey: string
  delivery: {
    agentIds: string[]
    pickedUpBy: string | null
    dispatchedAtIso: string | null
    deliveredAtIso: string | null
    proofType: string | null
    proofValue: string | null
    amountCollectedPaise: number | null
    failureReason: string | null
    codSettledAtIso: string | null
    codSettledBy: string | null
    collectedBy: string | null
  }
  riderName: Map<string, string>
  /** Riders the current role may pick from. Admin: every active rider. */
  riders: WorkspaceRider[]
  callNotes: CallNoteView[]
  cancelRequest: CancelRequestView | null
  rto: ReturnView | null
  canCollectReturns: boolean
  journey: JourneyEntry[]
  createdAtIso: string
  updatedAtIso: string
  /** The edit form's opening values, as its inputs take them. */
  editValues: Record<string, string>
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

const HEX_ID = /^[0-9a-f]{24}$/i

export async function loadOrderWorkspace(ctx: AuthContext, id: string): Promise<OrderWorkspace | null> {
  const order = await findById(ctx, id)
  if (!order) return null
  await connectDb()

  // `?? []` because findById is .lean(): orders from before the field have no
  // callLog at all, whatever the schema type says.
  const callLog = order.callLog ?? []
  const riderIdsInLog = order.events.flatMap((e) => {
    const m = (e.meta ?? {}) as Record<string, unknown>
    return [m.agentIds, m.fromAgentIds, m.riderIds, m.riderId, m.handedTo].flatMap((v) =>
      Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [],
    )
  })
  const actorIds = [
    ...order.events.map((e) => e.userId),
    ...callLog.map((n) => n.userId),
    order.delivery?.pickedUpBy,
    order.delivery?.codSettledBy,
    order.delivery?.collectedBy,
    ...order.delivery?.agentIds ?? [],
    ...riderIdsInLog.filter((v) => HEX_ID.test(v)),
  ].filter((v): v is NonNullable<typeof v> => Boolean(v))

  const isAdmin = ctx.role === 'ADMIN'
  const [outlets, actors, timings, cancelRequest, rto, dietLookup, scopedRiders, allRiders, canCollect] = await Promise.all([
    Restaurant.find(isAdmin ? { tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, _id: { $in: ctx.restaurantIds } })
      .select('name stationCode walkToPlatformMinutes active')
      .sort({ name: 1 })
      .lean(),
    User.find({ _id: { $in: actorIds }, tenantId: ctx.tenantId }).select('name role').lean(),
    // Cache-only for the call desk, like its own page; the kitchen and admin may fetch.
    timingForOrders([order], { allowFetch: isAdmin || ctx.role === 'STORE_MANAGER' }),
    viewCancelRequest(order),
    viewReturn(order),
    dietLookupFor(ctx.tenantId, [order]),
    listAssignableRiders(ctx, order.restaurantId),
    isAdmin
      ? User.find({ tenantId: ctx.tenantId, role: 'DELIVERY_AGENT', active: true }).select('name phone restaurantIds').sort({ name: 1 }).lean()
      : Promise.resolve([]),
    mayCollectReturns(ctx),
  ])

  const outlet = order.restaurantId ? (outlets.find((o) => o._id.equals(order.restaurantId!)) ?? null) : null
  const names = new Map(actors.map((a) => [String(a._id), a.name]))
  const labels = new Map(actors.map((a) => [String(a._id), `${a.name} · ${ROLE_LABEL[a.role] ?? a.role}`]))
  for (const r of allRiders) names.set(String(r._id), r.name)
  for (const r of scopedRiders) names.set(r.id, r.name)

  const timing = timingFor(order, timings)
  // An admin's own time is shown as theirs, never as a stale booking.
  const byAdmin = timedByAdmin(order)
  const scheduledShown = byAdmin ? (order.scheduledArrival ?? null) : (timing.scheduledArrival ?? order.scheduledArrival ?? null)
  const movedNow = scheduledShown && order.scheduledArrival && scheduledShown.getTime() !== order.scheduledArrival.getTime()
  const bookedShown = byAdmin ? null : (order.bookedArrival ?? (movedNow ? order.scheduledArrival : null))
  const eta = order.orderType === 'LOCAL' ? (order.readyBy ?? null) : (timing.effectiveArrival ?? scheduledShown)
  const walk = outlet?.walkToPlatformMinutes ?? 10
  const leaveBy = computeDispatchAt({ etaAt: eta, walkToPlatformMinutes: walk, bufferMinutes: env.DISPATCH_BUFFER_MINUTES })

  const row = order as unknown as Record<string, unknown>
  const editValues = Object.fromEntries(
    ORDER_EDIT_FIELDS.map((f) => {
      const v = row[f.key]
      if (v === null || v === undefined) return [f.key, '']
      if (f.kind === 'money') return [f.key, paiseToRupees(v as number)]
      if (f.kind === 'datetime') return [f.key, utcToIstLocal(v as Date)]
      return [f.key, String(v)]
    }),
  )

  const riders: WorkspaceRider[] = isAdmin
    ? allRiders.map((a) => ({
        id: String(a._id),
        name: a.name,
        phone: a.phone,
        atOutlet: (a.restaurantIds ?? []).some((r) => String(r) === String(order.restaurantId)),
      }))
    : scopedRiders.map((r) => ({ ...r, atOutlet: true }))

  const d = order.delivery
  return {
    id: String(order._id),
    externalOrderId: order.externalOrderId,
    status: order.status,
    orderType: order.orderType,
    source: order.source,
    sourceLabel: sourceLabel(order.source),
    serviceDate: order.serviceDate,
    stationCode: order.stationCode,
    outlet: outlet ? { id: String(outlet._id), name: outlet.name, stationCode: outlet.stationCode, walkMinutes: walk } : null,
    outlets: outlets.filter((o) => o.active !== false || String(o._id) === String(order.restaurantId)).map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}` })),
    trainNo: order.trainNo ?? null,
    trainName: order.trainName ?? null,
    coach: order.coach ?? null,
    berth: order.berth ?? null,
    rawSeat: order.rawSeat ?? null,
    handoverPoint: order.handoverPoint ?? null,
    pax: order.pax ?? null,
    readyByIso: order.readyBy?.toISOString() ?? null,
    contactName: order.contactName ?? null,
    contactPhone: order.contactPhone ?? null,
    amountPaise: order.amountPaise ?? null,
    paymentMode: order.paymentMode ?? null,
    notes: order.notes ?? null,
    remark: order.remark ?? null,
    kotNote: order.kotNote ?? null,
    pastedText: (order.rawPayload as { pastedText?: string } | null)?.pastedText ?? null,
    items: order.items.map((i) => {
      const tag = tagFor(dietLookup, order.source, i)
      return {
        id: String(i._id),
        name: i.name,
        qty: i.qty,
        pricePaise: i.pricePaise ?? null,
        notes: i.notes ?? null,
        spec: i.spec ?? null,
        isPacking: Boolean(i.isPacking),
        ownDiet: i.diet ?? null,
        diet: tag.diet,
        confirmed: tag.confirmed,
        composite: !isMenuDish(i),
      }
    }),
    timing,
    bookedIso: bookedShown?.toISOString() ?? null,
    scheduledIso: scheduledShown?.toISOString() ?? null,
    etaIso: eta?.toISOString() ?? null,
    leaveByIso: leaveBy?.toISOString() ?? null,
    runKey: runKeyFor(order),
    delivery: {
      agentIds: (d?.agentIds ?? []).map(String),
      pickedUpBy: d?.pickedUpBy ? (names.get(String(d.pickedUpBy)) ?? 'Unknown rider') : null,
      dispatchedAtIso: d?.dispatchedAt?.toISOString() ?? null,
      deliveredAtIso: d?.deliveredAt?.toISOString() ?? null,
      proofType: d?.proofType ?? null,
      proofValue: d?.proofValue ?? null,
      amountCollectedPaise: d?.amountCollectedPaise ?? null,
      failureReason: d?.failureReason ?? null,
      codSettledAtIso: d?.codSettledAt?.toISOString() ?? null,
      codSettledBy: d?.codSettledBy ? (names.get(String(d.codSettledBy)) ?? 'Unknown user') : null,
      collectedBy: d?.collectedBy ? (names.get(String(d.collectedBy)) ?? 'Unknown user') : null,
    },
    riderName: names,
    riders,
    callNotes: viewCallNotes(ctx, callLog, labels),
    cancelRequest,
    rto,
    canCollectReturns: canCollect,
    journey: order.events.map((e) =>
      journeyEntry(
        {
          fromStatus: e.fromStatus ?? null,
          toStatus: e.toStatus,
          actor: e.userId ? (names.get(String(e.userId)) ?? 'Unknown user') : 'System',
          meta: (e.meta ?? {}) as Record<string, unknown>,
          createdAt: e.createdAt,
        },
        names,
        order.source,
      ),
    ),
    createdAtIso: order.createdAt.toISOString(),
    updatedAtIso: order.updatedAt.toISOString(),
    editValues,
  }
}

/* ── the journey, as sentences ─────────────────────────────────────────── */

type RawEvent = {
  fromStatus: string | null
  toStatus: string
  actor: string
  meta: Record<string, unknown>
  createdAt: Date | string
}

/** "{Actor} accepted the order" rather than "ACCEPTED → KOT_PRINTED". */
export function journeyEntry(e: RawEvent, names: Map<string, string>, source: string): JourneyEntry {
  const at = typeof e.createdAt === 'string' ? e.createdAt : e.createdAt.toISOString()
  const reason = str(e.meta.reason)
  const who = e.actor
  const named = (ids: unknown) =>
    Array.isArray(ids) && ids.length > 0 ? ids.map((id) => names.get(String(id)) ?? 'Unknown rider').join(', ') : null
  const rider = str(e.meta.riderId) ? (names.get(String(e.meta.riderId)) ?? 'a rider') : null

  if (e.fromStatus === e.toStatus) {
    return { at, actor: who, reason, toStatus: null, ...sideAction(e.meta, who, names) }
  }

  if (!e.fromStatus) {
    const title =
      e.toStatus === 'ENQUIRY'
        ? `${who} opened the enquiry`
        : source === 'MANUAL'
          ? `${who} entered the order by hand`
          : `Order received from ${sourceLabel(source)}`
    return { at, actor: who, reason, toStatus: e.toStatus, title, detail: null }
  }

  const via = str(e.meta.via)
  const detail = via === 'admin-override' ? 'Set directly by an admin, outside the usual steps' : null
  let title: string
  switch (e.toStatus) {
    case 'QUOTED':
      title = `${who} sent a quote`
      break
    case 'RECEIVED':
      title = e.fromStatus === 'QUOTED' ? `${who} confirmed the enquiry as an order` : `${who} reopened the order`
      break
    case 'ACCEPTED':
      title = `${who} accepted the order`
      break
    case 'KOT_PRINTED':
      title = `${who} sent the KOT to the kitchen`
      break
    case 'PREPARED':
      title = e.fromStatus === 'DISPATCHED' ? `${who} put the bag back on the counter` : `${who} marked it ready`
      break
    case 'DISPATCHED':
      title = rider && rider !== who ? `${who} handed the bag to ${rider}` : `${who} left with the bag`
      break
    case 'DELIVERED':
      title = `${who} delivered it to the passenger`
      break
    case 'FAILED':
      title = `${who} could not deliver it`
      break
    case 'CANCELLED':
      title = `${who} cancelled the order`
      break
    case 'LOST':
      title = `${who} marked the enquiry lost`
      break
    case 'MISDELIVERY':
      title = `${who} recorded a misdelivery`
      break
    case 'MISSED_DELIVERY':
      title = `${who} recorded a missed delivery`
      break
    case 'REFUNDED':
      title = `${who} recorded a refund`
      break
    case 'RATING_ORDER':
      title = `${who} flagged this as a rating order`
      break
    default:
      title = `${who} set the status to ${e.toStatus.replace(/_/g, ' ').toLowerCase()}`
  }
  const ridersOut = named(e.meta.riderIds)
  return { at, actor: who, reason, toStatus: e.toStatus, title, detail: detail ?? (ridersOut ? `Carried by ${ridersOut}` : null) }
}

function sideAction(meta: Record<string, unknown>, who: string, names: Map<string, string>): { title: string; detail: string | null } {
  const list = (ids: unknown) =>
    Array.isArray(ids) && ids.length > 0 ? ids.map((id) => names.get(String(id)) ?? 'Unknown rider').join(', ') : 'nobody'
  switch (meta.action) {
    case 'FIELD_EDITED': {
      const def = orderField(String(meta.field))
      const label = def?.label ?? str(meta.label) ?? String(meta.field)
      return {
        title: `${who} changed ${label.toLowerCase()}`,
        detail: `${formatLoggedValue(def, meta.from)} → ${formatLoggedValue(def, meta.to)}`,
      }
    }
    case 'ITEM_EDITED': {
      const def = itemField(String(meta.field))
      const label = def?.label ?? str(meta.label) ?? String(meta.field)
      return {
        title: `${who} edited ${str(meta.item) ?? 'an item'}`,
        detail: `${label}: ${formatLoggedValue(def, meta.from)} → ${formatLoggedValue(def, meta.to)}`,
      }
    }
    case 'ITEM_ADDED':
    case 'ITEM_REMOVED': {
      const price = typeof meta.pricePaise === 'number' ? ` · ${formatMoney(meta.pricePaise)}` : ''
      return {
        title: `${who} ${meta.action === 'ITEM_ADDED' ? 'added' : 'removed'} ${str(meta.item) ?? 'an item'} ×${String(meta.qty ?? 1)}`,
        detail: `${price.replace(' · ', '')}${meta.isPacking ? ' packing' : ''}`.trim() || null,
      }
    }
    case 'ASSIGN_AGENTS':
    case 'ASSIGN_RIDERS':
      return {
        title: `${who} assigned ${list(meta.agentIds)}`,
        detail: Array.isArray(meta.fromAgentIds) ? `Was ${list(meta.fromAgentIds)}` : null,
      }
    case 'COD_SETTLED': {
      const from = names.get(String(meta.riderId)) ?? 'the rider'
      const handover =
        typeof meta.handoverOrders === 'number' && meta.handoverOrders > 1
          ? `One of ${meta.handoverOrders} orders, ${formatMoney(meta.handoverPaise as number)} in all`
          : null
      return { title: `${who} took ${formatMoney(typeof meta.amountPaise === 'number' ? meta.amountPaise : null)} cash from ${from}`, detail: handover }
    }
    case 'RTO_RETURNED':
      return { title: `${who} took the bag back at the outlet`, detail: str(meta.note) }
    case 'RTO_OPENED':
      return { title: 'Bag is coming back to the outlet', detail: str(meta.reason) ? rtoReasonLabel(String(meta.reason)) : null }
    case 'LEAVE_NOW': {
      const parts = [
        str(meta.platform) ? `platform ${meta.platform}` : null,
        typeof meta.delayMinutes === 'number' && meta.delayMinutes > 0 ? `${meta.delayMinutes} min late` : null,
      ].filter(Boolean)
      return { title: 'Time to leave for the platform', detail: parts.length ? parts.join(' · ') : null }
    }
    case 'CANCEL_REQUESTED':
      return { title: `${who} asked for the order to be cancelled`, detail: null }
    case 'CANCEL_REFUSED':
      return { title: `${who} refused the cancellation request`, detail: str(meta.note) }
    default:
      return {
        title: typeof meta.action === 'string' ? `${who}: ${meta.action.replace(/_/g, ' ').toLowerCase()}` : `${who} updated the order`,
        detail: null,
      }
  }
}
