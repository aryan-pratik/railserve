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
 * One passenger on the call board.
 *
 * Three bands, in the order of a call. Who and where they are (seat, name,
 * what they ordered) on top; the things you do with them (ring, note, cancel)
 * in the middle, aligned under the name so the eye drops straight down from
 * who to how; and what has already been said at the bottom, tinted so that
 * "called" and "not called yet" read at a glance without leaning on colour
 * alone: the words say it too.
 *
 * Everything on it comes from callBoardRow, which carries no money, so this
 * component cannot show any. The payment *mode* is there because it is what a
 * passenger asks about.
 *
 * The note box opens in place. A telecaller working down a train should not
 * leave the board after every call and lose their place in the run, so the
 * existing CallNoteForm is mounted here rather than behind the order page.
 * The order page stays one tap away for the full log.
 */

/** Left edge of the name column on wider screens: seat column (5.5rem) plus its gap (1rem). */
const INDENT = 'sm:pl-[6.5rem]'

export function CallBoardRow({ order: o }: { order: CallBoardRowData }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const called = o.lastCall !== null

  // Someone still to ring gets a faint wash, so the rows that need a call stand
  // out from the ones already done without a border colour doing it alone: the
  // panel below says it in words too.
  return (
    <li className={`px-4 py-4 sm:px-5 ${called ? '' : 'bg-amber-50/40'}`}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
        <div className="pt-0.5">
          {o.handoverPoint ? (
            <span className="text-sm font-semibold text-fuchsia-700">Handover</span>
          ) : (
            <CoachChip coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} size="lg" />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/calls/orders/${o.id}`}
              className={`rounded text-base font-semibold leading-snug text-ink underline-offset-2 hover:underline ${focusRing}`}
            >
              {o.contactName ?? o.externalOrderId}
            </Link>
            <TypeBadge type={o.orderType} />
            <CallNoteHint orderId={o.id} count={o.callNoteCount} hint={o.callNoteHint} />
          </div>
          <div className="mt-0.5 text-sm text-muted">
            <span className="font-mono">{o.externalOrderId}</span>
            {o.outletName ? ` · ${o.outletName}` : ''}
            {o.handoverPoint ? ` · ${o.handoverPoint}` : ''}
          </div>
          {o.itemSummary ? (
            <div className="mt-1 line-clamp-2 text-sm text-ink/80" title={o.itemSummary}>
              {o.itemSummary}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
          {/* The mode only: whether the passenger has paid is what they ask
              about, and the amount is not something this desk is given. */}
          <StatusBadge status={o.status} />
          <PaymentBadge mode={o.paymentMode} />
        </div>
      </div>

      <div className={`mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 ${INDENT}`}>
        {o.contactPhone ? (
          <a
            href={`tel:${o.contactPhone}`}
            className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-soft px-4 font-mono text-base font-semibold tabular-nums text-accent hover:bg-accent-soft/70 sm:w-auto sm:justify-start ${focusRing}`}
          >
            <IconPhone size={16} aria-hidden />
            {o.contactPhone}
          </a>
        ) : (
          <span className="text-sm text-faint">No number came in with this order</span>
        )}

        <Button
          type="button"
          variant="secondary"
          className="min-h-11 sm:min-h-10"
          aria-expanded={noteOpen}
          aria-controls={noteOpen ? `call-note-${o.id}` : undefined}
          onClick={() => setNoteOpen((v) => !v)}
        >
          Note
          <IconChevronDown
            size={14}
            aria-hidden
            className={`transition-transform motion-reduce:transition-none ${noteOpen ? 'rotate-180' : ''}`}
          />
        </Button>

        {o.canCancel ? <CancelOrderButton orderId={o.id} externalOrderId={o.externalOrderId} /> : null}
      </div>

      {/* Called or not, in words, so the state survives a glance and is not
          carried by a colour alone. */}
      <div
        className={`mt-3 rounded-lg px-3.5 py-2.5 text-sm ring-1 ring-inset sm:ml-[6.5rem] ${
          called
            ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
            : 'bg-amber-50 text-amber-900 ring-amber-200'
        }`}
      >
        {called ? (
          <>
            <p className="font-semibold">
              Called {o.lastCall!.atLabel}
              {o.lastCall!.by ? ` by ${o.lastCall!.by}` : ''}
            </p>
            <p className="mt-0.5 text-ink">{o.lastCall!.text}</p>
          </>
        ) : (
          <p className="font-semibold">Not called yet</p>
        )}
      </div>

      {noteOpen ? (
        <div id={`call-note-${o.id}`} className={`mt-2 ${INDENT}`}>
          <CallNoteForm orderId={o.id} onSaved={() => setNoteOpen(false)} />
        </div>
      ) : null}
    </li>
  )
}
