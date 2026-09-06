import { requireRole } from '@/lib/session'
import { findPayments, type PaymentQuery } from '@/lib/repo/paymentRepo'
import { resolveDateRange } from '@/lib/dateFilter'
import { formatIST, paiseToRupees } from '@/lib/format'

export const dynamic = 'force-dynamic'

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  // Quote when the value could otherwise break the row or the column.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV of what the payments page is currently showing.
 *
 * Takes the same query parameters as the page, so Export means "this view",
 * not "everything" — an export that ignores the filters you just set is a
 * different, less useful feature wearing the same label.
 *
 * Admin only, like the balance column it carries.
 */
export async function GET(request: Request) {
  await requireRole('ADMIN')
  const url = new URL(request.url)

  const mode = url.searchParams.get('mode') || 'all'
  const month = url.searchParams.get('month') ?? ''
  const rawFrom = url.searchParams.get('from') ?? ''
  const rawTo = url.searchParams.get('to') ?? ''
  const { from, to } = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })

  const query: PaymentQuery = { from, to, q: url.searchParams.get('q')?.trim() || undefined }
  // Reconciliation is the whole point of this file, so it gets far more
  // headroom than a screen does — a silently truncated CSV is worse than a
  // slow one.
  const payments = await findPayments(query, 10_000)

  const header = [
    'Transaction date', 'Received at', 'From', 'Amount (INR)', 'RRN',
    'Method', 'Account', 'Available balance (INR)', 'Remark',
  ]

  const rows = payments.map((p) => [
    p.transactionDate,
    formatIST(p.receivedAt),
    p.payerName,
    paiseToRupees(p.amountPaise),
    // Excel reads a long digit string as a number and renders it in
    // scientific notation; a leading tab keeps an RRN readable on open.
    `\t${p.rrn}`,
    p.method ?? '',
    p.accountLast4 ?? '',
    paiseToRupees(p.availableBalancePaise),
    p.remark ?? '',
  ])

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')

  return new Response(
    // Excel reads a UTF-8 CSV as the local codepage without a BOM, which turns
    // every ₹ and every non-ASCII payer name into mojibake on open.
    '﻿' + csv,
    {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="railserve-payments-${
          from || to ? `${from || 'start'}_to_${to || 'end'}` : 'all'
        }.csv"`,
        'cache-control': 'no-store',
      },
    },
  )
}
