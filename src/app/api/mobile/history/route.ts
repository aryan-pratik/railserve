import { NextResponse } from 'next/server'
import { contextFromBearer } from '@/lib/mobile/token'
import { findMany } from '@/lib/repo/orderRepo'
import { wasCancelledBy } from '@/lib/repo/transitionOrder'
import { lastSettlementFor, pendingCashFor } from '@/lib/repo/riderCashRepo'
import {
  closedAtOf, correctableUntil, escapeRegex, istDayRange, maskPhone, RIDER_RECENT_WINDOW_MS,
} from '@/lib/riderRecords'
import { preflight, withCors } from '@/lib/mobile/cors'

export const dynamic = 'force-dynamic'

/**
 * Finished orders that belong in a rider's record. A cancellation counts only
 * if the rider actually carried it (dispatchedAt set): an order the office
 * cancelled while it was still cooking was never in their hands, and would
 * otherwise pad their order count.
 */
function doneFilter(withCancelled: boolean) {
  const closed = { status: { $in: ['DELIVERED', 'FAILED'] } }
  if (!withCancelled) return closed
  return { $or: [closed, { status: 'CANCELLED', 'delivery.dispatchedAt': { $ne: null } }] }
}

/** Closed within [from, to), for orders with and without `delivery.closedAt`. */
function closedBetween(from: Date, to: Date) {
  return {
    $or: [
      { 'delivery.closedAt': { $gte: from, $lt: to } },
      { 'delivery.closedAt': null, 'delivery.deliveredAt': { $gte: from, $lt: to } },
      { 'delivery.closedAt': null, 'delivery.deliveredAt': null, updatedAt: { $gte: from, $lt: to } },
    ],
  }
}

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
 *   - ?date=YYYY-MM-DD: one IST day, any day back
 *   - ?q=…: search across everything the rider ever finished
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
  // never be sent a cancellation.
  const withCancelled = params.get('v') === '2'
  const now = new Date()

  let window: Record<string, unknown>
  let view: { kind: 'recent' | 'date' | 'search'; date?: string; q?: string }
  if (q) {
    window = searchFilter(q)
    view = { kind: 'search', q }
  } else if (date) {
    const range = istDayRange(date)
    if (!range) {
      return withCors(request, NextResponse.json({ error: 'Pick a valid date.' }, { status: 400 }))
    }
    window = closedBetween(range.from, range.to)
    view = { kind: 'date', date }
  } else {
    window = closedBetween(new Date(now.getTime() - RIDER_RECENT_WINDOW_MS), new Date(now.getTime() + 60_000))
    view = { kind: 'recent' }
  }

  const [orders, wallet, lastSettlement] = await Promise.all([
    findMany(
      ctx,
      { $and: [doneFilter(withCancelled), { 'delivery.agentIds': ctx.userId }, window] },
      { sort: { updatedAt: -1 }, limit: q ? 100 : 500 },
    ),
    pendingCashFor(ctx, ctx.userId),
    lastSettlementFor(ctx, ctx.userId),
  ])

  const rows = orders
    .map((o) => {
      const closedAt = closedAtOf(o)
      const openUntil = correctableUntil(closedAt, now)
      const editable =
        openUntil !== null &&
        !o.delivery.codSettledAt &&
        (o.status !== 'CANCELLED' || wasCancelledBy(o, ctx.userId))
      return {
        id: String(o._id),
        externalOrderId: o.externalOrderId,
        serviceDate: o.serviceDate,
        status: o.status,
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
        editableUntil: editable ? openUntil!.toISOString() : null,
      }
    })
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))

  return withCors(request, NextResponse.json({
    fetchedAt: now.toISOString(),
    view,
    orders: rows,
    wallet: {
      pendingPaise: wallet.paise,
      pendingOrders: wallet.orders,
      lastSettlement,
    },
  }))
}

export const OPTIONS = preflight
