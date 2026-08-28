import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { formatIST, paiseToRupees, todayIST } from '@/lib/format'
import type { QueryFilter } from 'mongoose'

export const dynamic = 'force-dynamic'

const TABS: Record<string, string[]> = {
  kitchen: ['ACCEPTED', 'KOT_PRINTED'],
  ready: ['PREPARED'],
  platform: ['DISPATCHED'],
  delivered: ['DELIVERED'],
  issues: ['FAILED', 'CANCELLED', 'LOST'],
}

/**
 * CSV of what the board is currently showing.
 *
 * Takes the same query parameters as the page, so Export means "this view",
 * not "everything" — an export that ignores the filters you just set is a
 * different, less useful feature wearing the same label.
 *
 * Reads through the scoped repository like every other query; an export route
 * that bypassed it would be the widest possible cross-tenant hole.
 */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  // Quote when the value could otherwise break the row or the column.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: Request) {
  const ctx = await requireRole('ADMIN')
  const url = new URL(request.url)

  const date = url.searchParams.get('date') || todayIST()
  const outlet = url.searchParams.get('outlet') ?? ''
  const statuses = TABS[url.searchParams.get('tab') ?? ''] ?? (LIVE_STATUSES as string[])

  const filter: QueryFilter<Record<string, unknown>> = {
    serviceDate: date,
    status: { $in: statuses },
  }
  if (outlet) filter.restaurantId = outlet

  const [orders, outlets] = await Promise.all([
    findMany(ctx, filter, { sort: { createdAt: 1 }, limit: 500 }),
    connectDb().then(() => Restaurant.find({}).select('name stationCode').lean()),
  ])
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

  const header = [
    'Order ID', 'Status', 'Type', 'Outlet', 'Station', 'Train no', 'Train name',
    'Scheduled arrival', 'Coach', 'Berth', 'Handover', 'Pax',
    'Passenger', 'Phone', 'Items', 'Amount (INR)', 'Payment', 'Created',
  ]

  const rows = orders.map((o) => [
    o.externalOrderId,
    o.status,
    o.orderType,
    outletName.get(String(o.restaurantId)) ?? '',
    o.stationCode,
    o.trainNo ?? '',
    o.trainName ?? '',
    o.scheduledArrival ? formatIST(o.scheduledArrival) : '',
    o.coach ?? '',
    o.berth ?? '',
    o.handoverPoint ?? '',
    o.pax ?? '',
    o.contactName ?? '',
    o.contactPhone ?? '',
    o.items.filter((i) => !i.isPacking).map((i) => `${i.name} x${i.qty}`).join('; '),
    paiseToRupees(o.amountPaise),
    o.paymentMode ?? '',
    formatIST(o.createdAt),
  ])

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')

  return new Response(
    // Excel reads a UTF-8 CSV as the local codepage without a BOM, which turns
    // every ₹ and every non-ASCII passenger name into mojibake on open.
    '﻿' + csv,
    {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="railserve-orders-${date}.csv"`,
        'cache-control': 'no-store',
      },
    },
  )
}
