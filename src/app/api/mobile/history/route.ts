import { NextResponse } from 'next/server'
import { contextFromBearer } from '@/lib/mobile/token'
import { findMany, onClosedRecord } from '@/lib/repo/orderRepo'
import { wasCancelledBy, wasClosedBy } from '@/lib/repo/transitionOrder'
import { collectionHistory, lastSettlementFor, pendingCashFor, receiversOf } from '@/lib/repo/riderCashRepo'
import { closedBetween, riderDays, riderDoneFilter, NO_RIDER_DAY } from '@/lib/repo/riderLedgerRepo'
import {
  closedAtOf, correctableUntil, escapeRegex, maskPhone, RIDER_RECENT_WINDOW_MS,
} from '@/lib/riderRecords'
import { opsDayOf, opsDayRange } from '@/lib/opsDay'
import { overallStatus, riderStatus, RIDER_LABEL } from '@/lib/orderViews'
import { rtoReasonLabel } from '@/lib/rto'
import { preflight, withCors } from '@/lib/mobile/cors'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'

export const dynamic = 'force-dynamic'

/** Order id, passenger name or phone, train or coach. */
function searchFilter(q: string) {
  const text = new RegExp(escapeRegex(q), 'i')
  const or: Record<string, unknown>[] = [
    { externalOrderId: text },
    { contactName: text },
    { trainNo: text },
    { coach: text },
  ]
  // Digits are matched across whatever the number was stored with — spaces,
  // dashes, a +91 — so "98765 43" and "9876543" find the same passenger.
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 3) or.push({ contactPhone: new RegExp(digits.split('').join('\\D*')) })
  return { $or: or }
}

/**
 * What this rider has already finished.
 *
 * /api/mobile/runs deliberately returns only live work, so a delivered order
 * vanishes the moment it is closed. That is right for the job list and wrong
 * for the rider, who needs to be able to answer "did I deliver that one?" and
 * see the cash they are accountable for.
 *
 * Three views on one route, all additive query params so an older app build
 * that sends none still gets a sensible answer:
 *   - no params: the last 48 hours
 *   - ?date=YYYY-MM-DD: one reporting day (3am to 3am IST), any day back
 *   - ?q=…: search across everything the rider ever finished
 *
 * The rows and the `summary` beside them come from the rider ledger
 * (riderLedgerRepo), the same source the admin's Riders page reads, with the
 * same day boundary. The app shows the summary as sent; it does not add the
 * rows up itself, so the two screens cannot drift apart again.
 *
 * The passenger's number is masked server-side once an order is 30 hours
 * closed, so the full number never reaches the phone after that.
 *
 * Filtered by delivery.agentIds rather than by outlet: this is the rider's own
 * record, not their outlet's. The repo still applies outlet scoping on top, so
 * a rider moved between outlets cannot read back orders they never touched.
 */
export async function GET(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const params = new URL(request.url).searchParams
  const q = (params.get('q') ?? '').trim().slice(0, 60)
  const date = params.get('date') ?? ''
  // Builds before v=2 render every non-FAILED row as delivered, so they must
  // never be sent a cancellation. v=2 knows CANCELLED. v=3 reads the rider
  // status and the server's summary, so it can be sent everything that
  // closed after pickup, with the stored status folded to the three
  // outcomes the app has words for.
  const v = Number(params.get('v') ?? '1')
  const outcomes = v >= 3 ? 'all' as const : v === 2 ? 'cancelled' as const : 'legacy' as const
  const now = new Date()

  let window: Record<string, unknown>
  let view: { kind: 'recent' | 'date' | 'search'; date?: string; q?: string }
  let summaryRange: { from: Date; to: Date } | null = null
  if (q) {
    window = searchFilter(q)
    view = { kind: 'search', q }
  } else if (date) {
    // Builds older than the 3am day send the calendar date for "Today".
    // Between midnight and 3 am that names a reporting day that has not
    // begun, and would show an empty list to a rider in mid-shift; read it
    // as the day in progress instead.
    const day = opsDayRange(date) && date > opsDayOf(now) ? opsDayOf(now) : date
    const range = opsDayRange(day)
    if (!range) {
      return withCors(request, NextResponse.json({ error: 'Pick a valid date.' }, { status: 400 }))
    }
    window = closedBetween(range.from, range.to)
    summaryRange = range
    view = { kind: 'date', date: day }
  } else {
    summaryRange = { from: new Date(now.getTime() - RIDER_RECENT_WINDOW_MS), to: new Date(now.getTime() + 60_000) }
    window = closedBetween(summaryRange.from, summaryRange.to)
    view = { kind: 'recent' }
  }
  const todayRange = opsDayRange(opsDayOf(now))!

  const [orders, wallet, lastSettlement, days, today, collections] = await Promise.all([
    findMany(
      ctx,
      { $and: [riderDoneFilter(outcomes), onClosedRecord(ctx.userId), window] },
      { sort: { updatedAt: -1 }, limit: q ? 100 : 500 },
    ),
    pendingCashFor(ctx, ctx.userId),
    lastSettlementFor(ctx, ctx.userId),
    summaryRange ? riderDays(ctx, [ctx.userId], summaryRange) : Promise.resolve(null),
    riderDays(ctx, [ctx.userId], todayRange),
    collectionHistory(ctx, [ctx.userId], { limit: 20 }),
  ])
  // Receivers of the handovers listed AND of every order row: an older day's
  // orders were often received by someone absent from the latest handovers.
  const receivers = await receiversOf([
    ...collections,
    ...orders.map((o) => ({ receivedById: o.delivery?.codSettledBy ? String(o.delivery.codSettledBy) : null })),
  ])
  const receiverOf = (id: unknown) => (id ? (receivers.get(String(id))?.name ?? null) : null)
  const summary = days ? (days.get(String(ctx.userId)) ?? NO_RIDER_DAY) : null
  const todaySummary = today.get(String(ctx.userId)) ?? NO_RIDER_DAY

  // Where a bag still in the rider's hands has to go back to. Looked up only
  // for orders with a return open, which is a handful at most.
  const returnOutletIds = [...new Set(
    orders.filter((o) => o.delivery?.rto && o.restaurantId).map((o) => String(o.restaurantId)),
  )]
  let outletName = new Map<string, string>()
  if (returnOutletIds.length > 0) {
    await connectDb()
    const outlets = await Restaurant.find({ _id: { $in: returnOutletIds } }).select('name stationCode').lean()
    outletName = new Map(outlets.map((r) => [String(r._id), `${r.name} · ${r.stationCode}`]))
  }

  const rows = orders
    .map((o) => {
      const closedAt = closedAtOf(o)
      const openUntil = correctableUntil(closedAt, now)
      const editable =
        openUntil !== null &&
        !o.delivery.codSettledAt &&
        // Only the three outcomes a rider can name, and only their own tap
        // (see correctRiderOutcome): what the office recorded is the office's.
        ['DELIVERED', 'FAILED', 'CANCELLED'].includes(o.status) &&
        (o.status !== 'CANCELLED' || wasCancelledBy(o, ctx.userId)) &&
        wasClosedBy(o, ctx.userId)
      // The app has words for three outcomes. Anything else that closed
      // after pickup reads as the overall status, with the detail beside it.
      const shown =
        o.status === 'DELIVERED' || o.status === 'FAILED' || o.status === 'CANCELLED'
          ? o.status
          : overallStatus(o.status) === 'DELIVERED' ? 'DELIVERED' : 'CANCELLED'
      const rs = riderStatus(o)
      return {
        id: String(o._id),
        externalOrderId: o.externalOrderId,
        serviceDate: o.serviceDate,
        status: shown,
        riderStatus: rs,
        riderStatusLabel: RIDER_LABEL[rs],
        statusDetail: shown !== o.status ? rtoReasonLabel(o.status) : null,
        trainNo: o.trainNo,
        trainName: o.trainName,
        coach: o.coach,
        berth: o.berth,
        handoverPoint: o.handoverPoint,
        contactName: o.contactName,
        contactPhone: openUntil ? o.contactPhone : maskPhone(o.contactPhone),
        phoneMasked: !openUntil && Boolean(o.contactPhone),
        amountPaise: o.amountPaise,
        paymentMode: o.paymentMode,
        itemCount: o.items.filter((i) => !i.isPacking).length,
        closedAt: closedAt?.toISOString() ?? null,
        deliveredAt: o.delivery.deliveredAt?.toISOString() ?? null,
        receivedBy: o.delivery.proofType === 'SIGNATURE' ? o.delivery.proofValue : null,
        amountCollectedPaise: o.delivery.amountCollectedPaise ?? null,
        failureReason: o.delivery.failureReason ?? null,
        codSettledAt: o.delivery.codSettledAt?.toISOString() ?? null,
        codReceivedBy: receiverOf(o.delivery.codSettledBy),
        editableUntil: editable ? openUntil!.toISOString() : null,
        // Null for almost every order: only one cancelled or failed after the
        // rider took it has a bag to bring back.
        rto: o.delivery.rto
          ? {
              status: o.delivery.rto.status,
              returnTo: o.restaurantId ? (outletName.get(String(o.restaurantId)) ?? null) : null,
              returnedAt: o.delivery.rto.returnedAt?.toISOString() ?? null,
            }
          : null,
      }
    })
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))

  return withCors(request, NextResponse.json({
    fetchedAt: now.toISOString(),
    view,
    orders: rows,
    // The figures for the period in view, and for the reporting day in
    // progress, counted by the server. Null for a search, which is not a period.
    summary,
    today: { day: opsDayOf(now), ...todaySummary },
    wallet: {
      pendingPaise: wallet.paise,
      pendingOrders: wallet.orders,
      lastSettlement,
    },
    // Every handover, newest first, and who received it.
    collections: collections.map((c) => ({
      id: c.id,
      at: c.at,
      paise: c.paise,
      orders: c.orders,
      receivedBy: receiverOf(c.receivedById),
      receivedAs: c.receivedById ? (receivers.get(c.receivedById)?.label ?? null) : null,
    })),
  }))
}

export const OPTIONS = preflight
