'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { CallBoardRowData } from '@/lib/orderView'
import { CallNoteHint } from '@/components/CallNoteHint'
import { CallNoteForm } from '@/components/CallNoteForm'
import { IconChevronDown, IconPhone } from '@/components/Icons'
import { Button, CoachChip, PaymentBadge, StatusBadge, TypeBadge, focusRing } from '@/components/ui'
import { CancelOrderButton } from './CancelOrderButton'

/**
 * One passenger on the call board, at kitchen-board density.
 *
 * One line, same shape as TrainRunCard's own order row (seat, name and meta,
 * then a right-aligned cluster) — a telecaller scans as many rows as a store
 * manager does, so it earns the same size. What this row adds beyond that
 * shape is the phone, the call state and the note/cancel actions, which sit
 * in the same right-hand cluster rather than in a second, taller block.
 *
 * Everything on it comes from callBoardRow, which carries no money, so this
 * component cannot show any. The payment *mode* is here because it is what a
 * passenger asks about.
 *
 * The note box opens in place, on its own line under the row, so a telecaller
 * working down a train does not leave the board after every call.
 */

/** Left edge under the name column: seat chip (5rem) plus its gap (0.75rem). */
const INDENT = 'sm:pl-20'

export function CallBoardRow({ order: o }: { order: CallBoardRowData }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const called = o.lastCall !== null

  return (
    <li className={called ? '' : 'bg-amber-50/30'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <div className="w-20 shrink-0">
          {o.handoverPoint ? (
            <span className="text-xs font-semibold text-fuchsia-700">Handover</span>
          ) : (
            <CoachChip coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
          )}
        </div>

        <div className="min-w-[10rem] flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/calls/orders/${o.id}`}
              className={`truncate rounded text-sm font-medium text-ink underline-offset-2 hover:underline ${focusRing}`}
            >
              {o.contactName ?? o.externalOrderId}
            </Link>
            <TypeBadge type={o.orderType} />
            <CallNoteHint orderId={o.id} count={o.callNoteCount} hint={o.callNoteHint} />
          </div>
          <div className="truncate text-xs text-muted">
            {o.outletName ? `${o.outletName} · ` : ''}
            {o.itemSummary ?? `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`}
          </div>
        </div>

        {/* Called or not, in a word, with the full note on hover — the same
            tooltip trick the note-count badge and the remark column use. */}
        <span
          title={called ? `${o.lastCall!.atLabel}${o.lastCall!.by ? ` · ${o.lastCall!.by}` : ''}: ${o.lastCall!.text}` : undefined}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ${
            called ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'
          }`}
        >
          {called ? `Called ${o.lastCall!.atLabel}` : 'Not called'}
        </span>

        {o.contactPhone ? (
          <a
            href={`tel:${o.contactPhone}`}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-accent hover:bg-accent-soft ${focusRing}`}
          >
            <IconPhone size={12} aria-hidden />
            {o.contactPhone}
          </a>
        ) : (
          <span className="text-xs text-faint">No number</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <PaymentBadge mode={o.paymentMode} />
          <StatusBadge status={o.status} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={noteOpen}
            aria-controls={noteOpen ? `call-note-${o.id}` : undefined}
            onClick={() => setNoteOpen((v) => !v)}
          >
            Note
            <IconChevronDown
              size={12}
              aria-hidden
              className={`transition-transform motion-reduce:transition-none ${noteOpen ? 'rotate-180' : ''}`}
            />
          </Button>
          {o.canCancel ? <CancelOrderButton orderId={o.id} externalOrderId={o.externalOrderId} /> : null}
        </div>
      </div>

      {noteOpen ? (
        <div id={`call-note-${o.id}`} className={`border-t border-line bg-sunken/40 ${INDENT}`}>
          <CallNoteForm orderId={o.id} onSaved={() => setNoteOpen(false)} />
        </div>
      ) : null}
    </li>
  )
}
