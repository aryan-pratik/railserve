'use client'

import { useActionState, useEffect, useState } from 'react'
import { formatMoney, formatServiceDate, formatShortDate, formatTimeIST } from '@/lib/format'
import { IconCheck, IconClose, IconPencil } from './Icons'
import { IconButton, thClass, focusRingInset } from './ui'
import { TableFrame } from './OrdersTable'
import { updatePaymentRemarkAction, type PaymentActionState } from '@/app/actions/payments'

type Maybe<T> = T | null | undefined

export type PaymentRow = {
  id: string
  payerName: string
  amountPaise: number
  rrn: string
  method?: Maybe<string>
  /** 'YYYY-MM-DD' in IST, as printed on the alert. */
  transactionDate: string
  /** ISO string: when the alert email itself arrived, which carries the time. */
  receivedAt: string
  remark?: Maybe<string>
}

const TD = 'px-3 py-2.5 align-top'
const EDIT_INPUT =
  'h-7 min-w-0 flex-1 rounded border border-line-strong bg-surface px-2 text-xs text-ink ' +
  'outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent'
const INITIAL_STATE: PaymentActionState = {}

/**
 * Money in, one row per bank alert. Identical for admin and store manager:
 * the balance is a figure in the panel above, not a column.
 *
 * Amount is what anyone scans for, so it is right-aligned and tabular; the
 * RRN is monospaced because it gets read out digit by digit over the phone.
 */
export function PaymentsTable({ payments }: { payments: PaymentRow[] }) {
  return (
    <TableFrame>
      <table className="w-full min-w-[46rem] table-fixed text-sm">
        {/* Widths follow how much each column can vary. The RRN is always 12
            digits and the amount rarely passes four figures, so the free-text
            remark gets what they do not need. */}
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '36%' }} />
        </colgroup>
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={thClass}>From</th>
            <th className={`${thClass} text-right`}>Amount</th>
            <th className={thClass}>RRN</th>
            <th className={thClass}>Date</th>
            <th className={thClass}>Remark</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {payments.map((p) => (
            <PaymentTableRow key={p.id} payment={p} />
          ))}
        </tbody>
      </table>
    </TableFrame>
  )
}

function PaymentTableRow({ payment }: { payment: PaymentRow }) {
  const [editing, setEditing] = useState(false)

  return (
    <tr className="group transition-colors hover:bg-sunken/50">
      <td className={TD}>
        <div className="truncate font-medium text-ink" title={payment.payerName}>{payment.payerName}</div>
        {payment.method ? (
          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">{payment.method}</div>
        ) : null}
      </td>
      {/* Exact paise, never rounded: this is the column someone reconciles a bank statement against. */}
      <td className={`${TD} text-right font-semibold tabular-nums text-emerald-700`}>
        {formatMoney(payment.amountPaise)}
      </td>
      <td className={TD}>
        <span className="block truncate font-mono text-xs tabular-nums text-muted" title={payment.rrn}>{payment.rrn}</span>
      </td>
      <td className={TD}>
        <div className="whitespace-nowrap text-ink" title={formatServiceDate(payment.transactionDate)}>
          {formatShortDate(payment.transactionDate)}
        </div>
        {/* The alert prints a date and no time; the email's own timestamp is
            the only record of when in the day the money landed. */}
        <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-faint">{formatTimeIST(payment.receivedAt)}</div>
      </td>
      <td className={TD}>
        {editing ? (
          <RemarkEditor paymentId={payment.id} initial={payment.remark} onDone={() => setEditing(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`flex w-full items-start gap-1.5 rounded text-left ${focusRingInset}`}
            title={payment.remark ? 'Edit remark' : 'Add a remark'}
          >
            {/* min-w-0 is load-bearing: a flex child refuses to shrink below
                its content, so a remark typed as one unbroken string would
                drag the table into a horizontal scroll. */}
            <span className={`min-w-0 flex-1 break-words ${payment.remark ? 'text-amber-800' : 'text-faint'}`}>
              {payment.remark ?? 'Add a remark'}
            </span>
            <IconPencil
              size={13}
              aria-hidden
              className="mt-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            />
          </button>
        )}
      </td>
    </tr>
  )
}

function RemarkEditor({
  paymentId,
  initial,
  onDone,
}: {
  paymentId: string
  initial: string | null | undefined
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState(updatePaymentRemarkAction, INITIAL_STATE)

  useEffect(() => {
    if (state.ok) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="paymentId" value={paymentId} />
      <div className="flex items-center gap-1">
        <input
          name="remark"
          defaultValue={initial ?? ''}
          autoFocus
          maxLength={200}
          placeholder="e.g. order 1000584805"
          className={EDIT_INPUT}
          aria-label="Remark"
          onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
        />
        <IconButton type="submit" aria-label="Save remark" size="sm" disabled={pending} className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
          <IconCheck size={14} />
        </IconButton>
        <IconButton aria-label="Cancel" size="sm" onClick={onDone}>
          <IconClose size={14} />
        </IconButton>
      </div>
      {state.error ? <span role="alert" className="text-[11px] font-medium text-red-600">{state.error}</span> : null}
    </form>
  )
}
