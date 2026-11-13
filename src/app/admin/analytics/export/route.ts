import { OVERALL_LABEL, overallStatus } from '@/lib/orderViews'
import { opsDayOf } from '@/lib/opsDay'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { findMany } from '@/lib/repo/orderRepo'
import { analyticsMatch, countOrdersBy } from '@/lib/repo/analyticsRepo'
import { riderNamesFor, riderOptions } from '@/lib/repo/riderFilter'
import {
  DIMENSION_LABEL, OUTCOME_LABEL, outcomeOf, readAnalyticsFilters, tallyByKey,
} from '@/lib/analytics'
import { sourceLabel } from '@/lib/orderEnums'
import { formatIST, paiseToRupees } from '@/lib/format'

/**
 * CSV of what Analytics is showing.
 *
 * Takes the page's own query string, so the file is the view that was on
 * screen: the same dates, outlet, station, aggregator, status, payment and
 * type. `report=orders` (the default) is one row per order, with its payment
 * and cash-on-delivery detail; `report=summary` is the comparison table, one
 * row per outlet, station, aggregator, payment mode or day.
 *
 * Reads through the scoped repositories like every other order query.
 */

/** Far above a busy month across every outlet; a clipped report is worse than a slow one. */
const MAX_ROWS = 50_000

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  // Quote when the value could otherwise break the row or the column.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvResponse(rows: unknown[][], filename: string): Response {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  // Excel reads a UTF-8 CSV as the local codepage without a BOM, which turns
  // every non-ASCII passenger name into mojibake on open.
  return new Response('﻿' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}

export async function GET(request: Request) {
  const ctx = await requireRole('ADMIN')
  const url = new URL(request.url)
  const sp: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key)
    sp[key] = all.length > 1 ? all : all[0]
  }
  const f = readAnalyticsFilters(sp)
  const match = analyticsMatch(f)
  const span = f.from === f.to ? f.from : `${f.from}_to_${f.to}`

  await connectDb()
  const outlets = await Restaurant.find({}).select('name stationCode').lean()
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

  if (url.searchParams.get('report') === 'summary') {
    const groups = tallyByKey(await countOrdersBy(ctx, match, f.by))
    if (f.by === 'day') groups.sort((a, b) => String(a.key).localeCompare(String(b.key)))
    const riders = f.by === 'rider' ? new Map((await riderOptions(ctx)).map((r) => [r.id, r.name])) : null
    const name = (key: string | null) => {
      if (riders) return key ? (riders.get(key) ?? 'Unknown rider') : 'No rider'
      if (f.by === 'outlet') return key ? (outletName.get(key) ?? 'Unknown outlet') : 'Unassigned'
      if (f.by === 'source') return sourceLabel(key)
      return key ?? 'Not recorded'
    }
    const pctDelivered = (n: number, of: number) => (of === 0 ? '' : ((n / of) * 100).toFixed(1))
    const rows = groups.map((g) => [
      name(g.key),
      g.total,
      g.counts.delivered,
      g.counts.progress,
      g.counts.undelivered,
      g.counts.cancelled,
      g.counts.other,
      pctDelivered(g.counts.delivered, g.total),
      paiseToRupees(g.amountPaise),
      paiseToRupees(g.deliveredPaise),
    ])
    return csvResponse(
      [
        [
          DIMENSION_LABEL[f.by], 'Orders', 'Delivered', 'In progress', 'Undelivered', 'Cancelled', 'Other',
          'Delivered %', 'Billed (INR)', 'Delivered value (INR)',
        ],
        ...rows,
      ],
      `railserve-analytics-by-${f.by}-${span}.csv`,
    )
  }

  const orders = await findMany(ctx, match, { sort: { serviceDate: 1, createdAt: 1 }, limit: MAX_ROWS })
  const riderName = await riderNamesFor(orders)

  const header = [
    'Order ID', 'Service date', 'Status', 'Outcome', 'Overall status', 'Reporting day (3am-3am)', 'Type', 'Aggregator', 'Outlet', 'Station',
    'Train no', 'Train name', 'Scheduled arrival', 'Coach', 'Berth', 'Passenger', 'Phone', 'Pax', 'Items',
    'Amount (INR)', 'Payment', 'COD collected (INR)', 'COD handed to store', 'Rider',
    'Delivered at', 'Not delivered reason', 'Created',
  ]
  const rows = orders.map((o) => {
    const codDelivered = o.paymentMode === 'COD' && o.status === 'DELIVERED'
    return [
      o.externalOrderId,
      o.serviceDate,
      o.status,
      OUTCOME_LABEL[outcomeOf(o.status)],
      OVERALL_LABEL[overallStatus(o.status)],
      // The day the order closed in, by the same fallbacks the rider pages
      // count with (closedBetween). Blank while open.
      overallStatus(o.status) === 'PROCESSING'
        ? ''
        : opsDayOf(o.delivery?.closedAt ?? o.delivery?.deliveredAt ?? o.updatedAt),
      o.orderType,
      sourceLabel(o.source),
      outletName.get(String(o.restaurantId)) ?? '',
      o.stationCode,
      o.trainNo ?? '',
      o.trainName ?? '',
      o.scheduledArrival ? formatIST(o.scheduledArrival) : '',
      o.coach ?? '',
      o.berth ?? '',
      o.contactName ?? '',
      o.contactPhone ?? '',
      o.pax ?? '',
      o.items.filter((i) => !i.isPacking).map((i) => `${i.name} x${i.qty}`).join('; '),
      paiseToRupees(o.amountPaise),
      o.paymentMode ?? '',
      // The rider's own figure, or the bill when nobody recorded one: the
      // same reading the screen and the rider cash pages use.
      codDelivered ? paiseToRupees(o.delivery?.amountCollectedPaise ?? o.amountPaise) : '',
      codDelivered ? (o.delivery?.codSettledAt ? formatIST(o.delivery.codSettledAt) : 'With rider') : '',
      riderName.get(String(o._id)) ?? '',
      o.delivery?.deliveredAt ? formatIST(o.delivery.deliveredAt) : '',
      o.delivery?.failureReason ?? '',
      formatIST(o.createdAt),
    ]
  })
  return csvResponse([header, ...rows], `railserve-analytics-orders-${span}.csv`)
}
