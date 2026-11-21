import mongoose from 'mongoose'
import type { AuthContext } from '@/lib/authContext'
import { loadRunBoard, todayBoardFilter, yesterdayBoardFilter } from '@/lib/board'
import { countOrders } from '@/lib/repo/orderRepo'
import { orderDietsFor } from '@/lib/repo/menuRepo'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { callNoteRow, foodItemLabels } from '@/lib/orderView'
import { connectDb } from '@/lib/db'
import { Restaurant, Station, User } from '@/lib/models'
import { computeDispatchAt } from '@/lib/train/policy'
import { env } from '@/lib/env'
import { runTrainLabel } from '@/lib/runs'
import { formatTimeIST, todayIST } from '@/lib/format'
import { maskPhone } from '@/lib/riderRecords'
import { timingFor, timingForOrders, type TrainFeedHealth } from '@/lib/train/service'
import {
  KITCHEN_STATUS_FILTERS,
  countsFor,
  startDateLabelFor,
  trackingNoteFor,
  type KitchenDay,
  type KitchenOrder,
  type KitchenRun,
} from './kitchenView'

/*
 * The server side of the kitchen board: one read that shapes `loadRunBoard`
 * into serialisable runs for the desk and the wall, plus the counts behind
 * the day tabs, the riders for the handover select and the outlets for the
 * admin's filter.
 */

export type KitchenQuery = {
  day: KitchenDay
  /** A picked service day (YYYY-MM-DD, never today); overrides `day`. */
  date: string | null
  statusKey: string | null
  /** Admin only: narrow to one outlet or one station. */
  outletId: string | null
  stationCode: string | null
}

export type KitchenOutlet = { id: string; name: string; stationCode: string; walk: number }

export type KitchenBoard = {
  runs: KitchenRun[]
  dayCounts: Record<KitchenDay, number>
  riders: { id: string; name: string }[]
  outlets: KitchenOutlet[]
  stations: { code: string; label: string }[]
  showOutlet: boolean
  feedHealth: TrainFeedHealth
  loadedAtIso: string
  serverNowMs: number
}

export function parseKitchenQuery(sp: Record<string, string | string[] | undefined>, isAdmin: boolean, today = todayIST()): KitchenQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const day = one(sp.day)
  const date = one(sp.date)
  const status = one(sp.status)
  const outlet = one(sp.outlet)
  return {
    day: day === 'yesterday' || day === 'upcoming' ? day : 'today',
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== today && !Number.isNaN(Date.parse(date)) ? date : null,
    statusKey: KITCHEN_STATUS_FILTERS.some((f) => f.key === status) ? status : null,
    outletId: isAdmin && mongoose.isValidObjectId(outlet) ? outlet : null,
    stationCode: isAdmin && /^[A-Z]{2,5}$/.test(one(sp.station)) ? one(sp.station) : null,
  }
}

export async function loadKitchenBoard(ctx: AuthContext, q: KitchenQuery, now = new Date()): Promise<KitchenBoard> {
  const isAdmin = ctx.role === 'ADMIN'
  const filter = KITCHEN_STATUS_FILTERS.find((f) => f.key === q.statusKey) ?? null
  const statuses = filter?.statuses
  const today = todayIST(now)

  // The admin's outlet / station narrowing, applied to the tab counts here and
  // to the loaded runs below. Mongoose casts the id string for the count.
  const scope: Record<string, unknown> = {}
  if (q.outletId) scope.restaurantId = new mongoose.Types.ObjectId(q.outletId)
  if (q.stationCode) scope.stationCode = q.stationCode
  const picked = filter ? { status: { $in: filter.statuses } } : { status: { $in: LIVE_STATUSES } }

  await connectDb()
  const [board, todayCount, yesterdayCount, upcomingCount, riderDocs, outletDocs, stationDocs] = await Promise.all([
    // A picked day replaces the tab: that service day, every status unless narrowed.
    q.date ? loadRunBoard(ctx, 'date', { date: q.date, statuses, now }) : loadRunBoard(ctx, q.day, { statuses, now }),
    countOrders(ctx, { $and: [todayBoardFilter(now, statuses), scope] }),
    countOrders(ctx, { $and: [yesterdayBoardFilter(now, statuses), scope] }),
    countOrders(ctx, { serviceDate: { $gt: today }, ...picked, ...scope }),
    User.find({
      role: 'DELIVERY_AGENT',
      active: true,
      ...(isAdmin ? {} : { restaurantIds: { $in: ctx.restaurantIds } }),
    })
      .select('name')
      .sort({ name: 1 })
      .lean(),
    Restaurant.find(isAdmin ? {} : { _id: { $in: ctx.restaurantIds } })
      .select('name stationCode walkToPlatformMinutes')
      .sort({ name: 1 })
      .lean(),
    isAdmin ? Station.find({}).select('name').lean() : Promise.resolve([]),
  ])

  const outlets: KitchenOutlet[] = outletDocs.map((o) => ({
    id: String(o._id),
    name: o.name,
    stationCode: o.stationCode,
    walk: o.walkToPlatformMinutes ?? 10,
  }))
  const outletById = new Map(outlets.map((o) => [o.id, o]))
  const stationName = new Map(stationDocs.map((s) => [String(s._id), s.name]))
  const stations = [...new Set(outlets.map((o) => o.stationCode))].sort().map((code) => ({
    code,
    label: stationName.get(code) ? `${code} · ${stationName.get(code)}` : code,
  }))
  const showOutlet = isAdmin || ctx.restaurantIds.length > 1

  // loadRunBoard takes no outlet filter, so the admin's narrowing is applied
  // to the loaded rows. A run that loses every order to the filter goes too.
  const runs = board.runs
    .map((run) => ({
      run,
      orders: run.orders.filter(
        (o) =>
          (!q.outletId || String(o.restaurantId) === q.outletId) &&
          (!q.stationCode || o.stationCode === q.stationCode),
      ),
    }))
    .filter((r) => r.orders.length > 0)

  const diets = await orderDietsFor(runs.flatMap((r) => r.orders))

  const shaped: KitchenRun[] = runs.map(({ run, orders }) => {
    const t = board.timingOf(run)
    const walk = Math.max(0, ...orders.map((o) => outletById.get(String(o.restaurantId))?.walk ?? 10))
    const leaveBy = computeDispatchAt({
      etaAt: t.effectiveArrival,
      walkToPlatformMinutes: walk || 10,
      bufferMinutes: env.DISPATCH_BUFFER_MINUTES,
    })
    const rows: KitchenOrder[] = orders.map((o) => {
      const notes = callNoteRow(o)
      return {
        id: String(o._id),
        externalOrderId: o.externalOrderId,
        orderType: o.orderType,
        source: o.source ?? null,
        status: o.status,
        coach: o.coach ?? null,
        berth: o.berth ?? null,
        rawSeat: o.rawSeat ?? null,
        handoverPoint: o.handoverPoint ?? null,
        pax: o.pax ?? null,
        contactName: o.contactName ?? null,
        contactPhone: maskPhone(o.contactPhone),
        itemNames: foodItemLabels(o.items),
        diet: diets.get(String(o._id)) ?? null,
        amountPaise: o.amountPaise ?? null,
        paymentMode: o.paymentMode ?? null,
        outletName: showOutlet ? (outletById.get(String(o.restaurantId))?.name ?? null) : null,
        note: o.kotNote?.trim() || o.remark?.trim() || null,
        receivedAtIso: o.createdAt.toISOString(),
        placedLabel: formatTimeIST(o.createdAt),
        callNoteCount: notes.callNoteCount,
        callNoteHint: notes.callNoteHint,
      }
    })
    const statusCounts: Record<string, number> = {}
    for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1
    return {
      key: run.key,
      local: run.local,
      trainNo: run.trainNo,
      trainLabel: runTrainLabel(run),
      trainName: run.trainName,
      stationCode: run.stationCode,
      serviceDate: run.serviceDate,
      etaIso: t.effectiveArrival?.toISOString() ?? null,
      bookedIso: t.scheduledArrival?.toISOString() ?? null,
      platform: t.platform,
      delayMinutes: t.delayMinutes,
      arrived: t.arrived,
      timetableOnly: t.source === 'SCHEDULED' && !run.local,
      leaveByIso: leaveBy?.toISOString() ?? null,
      startDateLabel: startDateLabelFor(t.startDate, run.serviceDate),
      trackingNote: trackingNoteFor(t),
      counts: countsFor(orders.map((o) => o.status)),
      statusCounts,
      codTotalPaise: orders.filter((o) => o.paymentMode === 'COD').reduce((s, o) => s + (o.amountPaise ?? 0), 0),
      itemCount: rows.reduce((n, o) => n + o.itemNames.length, 0),
      orders: rows,
    }
  })

  return {
    runs: shaped,
    dayCounts: { today: todayCount, yesterday: yesterdayCount, upcoming: upcomingCount },
    riders: riderDocs.map((r) => ({ id: String(r._id), name: r.name })),
    outlets,
    stations,
    showOutlet,
    feedHealth: board.feedHealth,
    loadedAtIso: board.loadedAt.toISOString(),
    serverNowMs: now.getTime(),
  }
}

/** The board's URL for a change of one or more params; empty values drop out. */
export function kitchenHref(
  current: KitchenQuery & { wall?: boolean; page?: number; pageSize?: number },
  patch: Partial<KitchenQuery & { wall: boolean; page: number; pageSize: number }> = {},
): string {
  const q = { ...current, ...patch }
  const u = new URLSearchParams()
  if (q.day !== 'today') u.set('day', q.day)
  if (q.date) u.set('date', q.date)
  if (q.statusKey) u.set('status', q.statusKey)
  if (q.outletId) u.set('outlet', q.outletId)
  if (q.stationCode) u.set('station', q.stationCode)
  if (q.wall) u.set('wall', '1')
  if (q.page && q.page > 1) u.set('page', String(q.page))
  if (q.pageSize && q.pageSize !== 20) u.set('pageSize', String(q.pageSize))
  const s = u.toString()
  return s ? `/v2/kitchen?${s}` : '/v2/kitchen'
}

/**
 * The live timing of one run, for a page that shows one train rather than
 * the board: the KOT preview's print guard needs the delay and the ETA.
 */
export async function runTimingFor(run: { orders: Parameters<typeof timingForOrders>[0] }): Promise<{ delayMinutes: number | null; etaIso: string | null }> {
  const first = run.orders[0]
  if (!first) return { delayMinutes: null, etaIso: null }
  const t = timingFor(first, await timingForOrders(run.orders))
  return { delayMinutes: t.delayMinutes, etaIso: t.effectiveArrival?.toISOString() ?? null }
}
