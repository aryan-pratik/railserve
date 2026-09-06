'use client'

import { useActionState, useEffect, useState } from 'react'
import { formatMoney, formatServiceDate, formatTimeIST } from '@/lib/format'
import { IconCheck, IconClose, IconPencil } from './Icons'
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
  /** ISO string — when the alert email itself arrived, which carries the time. */
  receivedAt: string
  remark?: Maybe<string>
}

const TH = 'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted'
const TD = 'px-4 py-3 align-top'
const ICON_BUTTON =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const EDIT_INPUT =
  'min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-ink ' +
  'outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent'
const INITIAL_STATE: PaymentActionState = {}

/**
 * Money in, one row per bank alert. Identical for admin and store manager —
 * the balance is a figure in the panel above, not a column, so there is one
 * table to keep right rather than two that drift.
 *
 * Amount is what anyone scans for, so it is right-aligned and tabular; the
 * RRN is monospaced because it gets read out digit by digit when someone is
 * quoting a reference over the phone.
 */
export function PaymentsTable({ payments }: { payments: PaymentRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '25%' }} />
          </colgroup>
          <thead className="border-b border-line bg-sunken/60">
            <tr>
              <th className={TH}>From</th>
              <th className={`${TH} text-right`}>Amount</th>
              <th className={TH}>RRN</th>
              <th className={TH}>Date</th>
              <th className={TH}>Remark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {payments.map((p) => (
              <PaymentTableRow key={p.id} payment={p} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PaymentTableRow({ payment }: { payment: PaymentRow }) {
  const [editing, setEditing] = useState(false)

  return (
    <tr className="group transition hover:bg-sunken/50">
      <td className={TD}>
        <div className="truncate font-medium text-ink" title={payment.payerName}>
          {payment.payerName}
        </div>
        {payment.method ? (
          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">
            {payment.method}
          </div>
        ) : null}
      </td>
      {/* Money in reads as money in. Exact paise, never rounded — this is the
          column someone reconciles a bank statement against. */}
      <td className={`${TD} text-right font-semibold tabular-nums text-emerald-700`}>
        {formatMoney(payment.amountPaise)}
      </td>
      <td className={TD}>
        <span
          className="block truncate font-mono text-xs tabular-nums text-muted"
          title={payment.rrn}
        >
          {payment.rrn}
        </span>
      </td>
      <td className={TD}>
        <div className="whitespace-nowrap text-ink">{formatServiceDate(payment.transactionDate)}</div>
        {/* The alert prints a date and no time; the email's own timestamp is
            the only record of when in the day the money actually landed. */}
        <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-faint">
          {formatTimeIST(payment.receivedAt)}
        </div>
      </td>
      <td className={TD}>
        {editing ? (
          <RemarkEditor
            paymentId={payment.id}
            initial={payment.remark}
            onDone={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex w-full items-start gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={payment.remark ? 'Edit remark' : 'Add a remark'}
          >
            <span className={payment.remark ? 'text-amber-800' : 'italic text-faint'}>
              {payment.remark ?? 'Add a remark'}
            </span>
            {/* Kept out of the way until the row is under the cursor or the
                keyboard is on the control — a pencil on every row of a
                hundred is noise competing with the amounts. */}
            <IconPencil
              size={13}
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
          // Escape abandons the edit — the same reflex as every other inline
          // editor, and quicker than aiming at a 28px button.
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDone()
          }}
        />
        <button
          type="submit"
          disabled={pending}
          className={`${ICON_BUTTON} text-emerald-700 hover:bg-emerald-50 disabled:opacity-40`}
          aria-label="Save remark"
        >
          <IconCheck size={14} />
        </button>
        <button
          type="button"
          onClick={onDone}
          className={`${ICON_BUTTON} text-muted hover:bg-sunken hover:text-ink`}
          aria-label="Cancel"
        >
          <IconClose size={14} />
        </button>
      </div>
      {state.error ? (
        <span className="text-[11px] font-medium text-red-600">{state.error}</span>
      ) : null}
    </form>
  )
}
