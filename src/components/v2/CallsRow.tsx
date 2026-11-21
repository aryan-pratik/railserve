'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Phone } from 'lucide-react'
import type { CallBoardRowData } from '@/lib/orderView'
import { sourceLabel } from '@/lib/orderEnums'
import { callsCopyText, paymentModeLabel } from '@/lib/v2/calls'
import { CallsCancelButton } from './CallsCancelButton'
import { CallsCopyButton } from './CallsCopyButton'
import { CallsNoteForm } from './CallsNoteForm'
import { Button, Chip, Mono, Seat, cx, statusChip, v2Focus } from './ui'

/**
 * One passenger on the call board. Everything here comes from callBoardRow,
 * which carries no money, so the row cannot show any; the payment mode is
 * here because it is what the passenger asks about. The note form opens in
 * place so a run can be worked top to bottom without leaving the board.
 */
export function CallsRow({
  row: o,
  train,
  canCancel,
}: {
  row: CallBoardRowData
  /** Only in the flat view, where no run header says which train this is. */
  train?: { trainLabel: string; trainName: string | null } | null
  canCancel: boolean
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const called = o.lastCall !== null
  const status = statusChip(o.status)
  const pay = paymentModeLabel(o.paymentMode)

  return (
    <li className="group/row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        {train !== undefined ? (
          <div className="w-[4.5rem] shrink-0">
            {train ? (
              <>
                <Mono className="block text-xs font-semibold">{train.trainLabel}</Mono>
                <span className="block truncate text-[10.5px] text-v2-faint">{train.trainName}</span>
              </>
            ) : (
              <span className="text-xs text-v2-faint">No train</span>
            )}
          </div>
        ) : null}

        <div className="w-[5.5rem] shrink-0">
          {o.handoverPoint ? (
            <span className="block truncate text-xs font-semibold text-v2-ink-2" title={o.handoverPoint}>
              {o.orderType === 'LOCAL' ? 'Deliver to' : 'Handover'}
            </span>
          ) : (
            <Seat coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
          )}
        </div>

        {/* Wide enough that on a phone the chips wrap under rather than the name truncating to "Anita Ve…". */}
        <div className="min-w-0 flex-1 basis-full sm:basis-0 sm:min-w-[14rem]">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link href={`/v2/orders/${o.id}`} className={cx('min-w-0 truncate rounded text-sm font-bold underline-offset-2 hover:underline', v2Focus)}>
              {o.contactName ?? o.externalOrderId}
            </Link>
            <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-v2-faint">
              {o.orderType}
              {o.source ? ` · ${sourceLabel(o.source)}` : ''}
            </span>
          </div>
          <div className="truncate text-xs text-v2-muted" title={o.itemSummary ?? undefined}>
            {o.outletName ? `${o.outletName} · ` : ''}
            {o.handoverPoint ? `${o.handoverPoint} · ` : ''}
            {o.itemSummary ?? `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`}
          </div>
        </div>

        {/* Called or not, in a word; the latest note on hover. */}
        <span title={called ? `${o.lastCall!.atLabel}${o.lastCall!.by ? ` · ${o.lastCall!.by}` : ''}: ${o.lastCall!.text}` : o.callNoteHint ?? undefined}>
          <Chip tone={called ? 'ok' : 'warn'}>{called ? `Called ${o.lastCall!.atLabel}` : 'Not called'}</Chip>
        </span>

        {o.contactPhone ? (
          <a
            href={`tel:${o.contactPhone}`}
            className={cx('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-v2-brand hover:bg-v2-brand-soft', v2Focus)}
          >
            <Phone size={12} aria-hidden />
            {o.contactPhone}
          </a>
        ) : (
          <span className="text-xs text-v2-faint">No number</span>
        )}

        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
          {pay ? <Chip tone={o.paymentMode === 'COD' ? 'cod' : 'grey'}>{pay}</Chip> : null}
          <Chip tone={status.tone}>{status.label}</Chip>
          <CallsCopyButton
            text={callsCopyText(o, train)}
            label="Copy order details"
            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
          />
          <Button
            type="button"
            size="sm"
            aria-expanded={noteOpen}
            aria-controls={noteOpen ? `call-note-${o.id}` : undefined}
            onClick={() => setNoteOpen((v) => !v)}
          >
            Note
            <ChevronDown size={13} aria-hidden className={cx('transition-transform motion-reduce:transition-none', noteOpen && 'rotate-180')} />
          </Button>
          {canCancel ? <CallsCancelButton orderId={o.id} externalOrderId={o.externalOrderId} /> : null}
        </div>
      </div>

      {noteOpen ? (
        <div id={`call-note-${o.id}`} className="border-t border-v2-line bg-v2-surface-2/60 px-4 py-3 sm:pl-[7.75rem]">
          <CallsNoteForm orderId={o.id} onSaved={() => setNoteOpen(false)} />
        </div>
      ) : null}
    </li>
  )
}
