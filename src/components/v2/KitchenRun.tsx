'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatRupees, formatTimeIST } from '@/lib/format'
import { kitchenRunText, runAnchor, type KitchenOrder, type KitchenRun as KitchenRunData } from '@/lib/v2/kitchenView'
import { RunHeader } from './RunHeader'
import { Chip, Mono, Seat, cx, statusChip, v2Focus } from './ui'
import { KitchenCheckNowButton, KitchenCopyButton, KitchenDietMarks, KitchenNoteHint, useRunFold } from './KitchenBits'
import { KitchenRunActions, type RunActionContext } from './KitchenRunActions'
import { useLongPress } from './useLongPress'
import { DishList } from './DishList'

/**
 * One train on the desk: the departure-board strip, every order on it as a
 * row, and the footer with the one next step. Ticks on the rows narrow the
 * footer to those orders: one train can be half ready, or need two riders.
 *
 * A client component because the ticks live in the rows and the buttons in
 * the footer; the selection is this component's own state, cleared after a
 * move goes through.
 */
export function KitchenRun({
  run,
  riders,
  serverNowMs,
  delayThresholdMinutes,
  showOutlet,
}: {
  run: KitchenRunData
  riders: { id: string; name: string }[]
  serverNowMs: number
  delayThresholdMinutes: number
  showOutlet: boolean
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [open, setOpen] = useRunFold('kitchen', run.key)
  const rowsId = `${runAnchor(run.key)}-rows`
  // After a refresh an order can leave the run (delivered, cancelled); a tick
  // on a row that is no longer there must not keep counting.
  const selected = useMemo(() => {
    const ids = new Set(run.orders.map((o) => o.id))
    return new Set([...picked].filter((id) => ids.has(id)))
  }, [run.orders, picked])
  const allTicked = run.orders.length > 0 && run.orders.every((o) => selected.has(o.id))

  // The status each order had when it was ticked. A tick is "do the next
  // step to this order"; once the order has moved (by this footer, the wall,
  // or anyone else) the tick has been spent and must not carry over to the
  // step after. The footer's own onDone cannot be relied on for this: the
  // refresh that brings the new status unmounts the form before its effect
  // sees the success.
  const statusAtPick = useRef(new Map<string, string>())
  const statusNow = useMemo(() => new Map(run.orders.map((o) => [o.id, o.status])), [run.orders])
  const remember = (ids: Iterable<string>) => {
    for (const id of ids) statusAtPick.current.set(id, statusNow.get(id) ?? '')
  }
  const toggle = (id: string) => {
    remember([id])
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const setAll = (on: boolean) => {
    const ids = run.orders.map((o) => o.id)
    remember(ids)
    setPicked(on ? new Set(ids) : new Set())
  }
  // Stable, and a no-op when nothing is ticked: the footer calls it from an
  // effect after a successful move, and a fresh Set every time would loop.
  const clear = useCallback(() => setPicked((prev) => (prev.size === 0 ? prev : new Set())), [])
  useEffect(() => {
    if (selected.size === 0) return
    for (const id of selected) {
      if (statusAtPick.current.get(id) !== statusNow.get(id)) {
        clear()
        return
      }
    }
  }, [selected, statusNow, clear])

  const ctx: RunActionContext = {
    runKey: run.key,
    trainLabel: run.trainLabel,
    delayMinutes: run.delayMinutes,
    etaIso: run.etaIso,
    delayThresholdMinutes,
    riders,
    kotHref: `/v2/kitchen/kot/${encodeURIComponent(run.key)}`,
  }

  // The header's summary line is short: the leave-by time first, since it is
  // the one the kitchen acts on, then the cash. (The timetable caveat sits
  // under the ETA as the tracking note.)
  const summary = [
    run.leaveByIso && !run.arrived ? `send out by ${formatTimeIST(run.leaveByIso)}` : null,
    run.codTotalPaise > 0 ? `${formatRupees(run.codTotalPaise)} cash to collect` : null,
    !open ? `${run.orders.length} order${run.orders.length === 1 ? '' : 's'} hidden` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section
      id={runAnchor(run.key)}
      className="grid scroll-mt-4 gap-0 overflow-hidden rounded-v2-xl border border-v2-line bg-v2-surface shadow-[0_1px_2px_rgba(16,24,20,0.04),0_10px_28px_-16px_rgba(16,24,20,0.18)] target:ring-2 target:ring-v2-brand target:ring-offset-4 target:ring-offset-v2-surface"
      aria-label={`${run.trainLabel} ${run.trainName ?? ''}`}
    >
      <RunHeader
        trainLabel={run.trainLabel}
        trainName={run.local ? 'Local orders' : run.trainName}
        stationCode={run.stationCode}
        startDateLabel={run.startDateLabel}
        trackingNote={run.trackingNote}
        etaIso={run.etaIso}
        bookedIso={run.bookedIso}
        platform={run.platform}
        delayMinutes={run.delayMinutes}
        arrived={run.arrived}
        serverNowMs={serverNowMs}
        counts={run.counts}
        summary={summary || null}
        className={cx('!rounded-none !border-x-0 !border-t-0', open ? '!border-b !border-v2-line' : '!border-b-0')}
        fold={{ open, onToggle: () => setOpen(!open), controls: rowsId }}
        actions={<TrainTools run={run} />}
      />
      <div id={rowsId} hidden={!open}>
        {/* The one next step for this train, big and first: what the kitchen does now. */}
        <div className="border-b border-v2-line px-4 py-3">
          <KitchenRunActions
            run={ctx}
            counts={run.statusCounts}
            ticked={run.orders.filter((o) => selected.has(o.id)).map((o) => ({ id: o.id, status: o.status }))}
            onClear={clear}
          />
          <p className="mt-1.5 text-[12.5px] text-v2-muted">
            {selected.size > 0 ? 'The button acts on the ticked orders only.' : 'Acts on the whole train. Tick or hold an order to pick only some.'}{' '}
            <button type="button" className="font-semibold text-v2-brand underline-offset-2 hover:underline" onClick={() => setAll(!allTicked)}>
              {allTicked ? 'Untick all' : 'Tick all'}
            </button>
          </p>
        </div>
        <ul className="divide-y divide-v2-line">
          {run.orders.map((o) => (
            <OrderRow key={o.id} o={o} selected={selected.has(o.id)} onToggle={() => toggle(o.id)} onHold={() => (selected.has(o.id) ? null : toggle(o.id))} showOutlet={showOutlet} />
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * Two small tools for one train: ask the railway for the live time now, and
 * copy the train's details to paste elsewhere. Icons, so they stay out of
 * the way of the one big step on the card.
 */
function TrainTools({ run }: { run: KitchenRunData }) {
  return (
    <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {!run.local && run.trainNo && run.orders[0] ? <KitchenCheckNowButton orderId={run.orders[0].id} /> : null}
      <KitchenCopyButton text={kitchenRunText(run)} label="Copy train details" />
    </span>
  )
}

/**
 * One order as the kitchen reads it: where it goes (seat), who it is for,
 * what to cook, how it is paid, and where it is now. Tapping it opens the
 * order. The order number and phone stay on the order page.
 */
function OrderRow({
  o,
  selected,
  onToggle,
  onHold,
  showOutlet,
}: {
  o: KitchenOrder
  selected: boolean
  onToggle: () => void
  onHold: () => void
  showOutlet: boolean
}) {
  const status = statusChip(o.status)
  const cash = o.paymentMode === 'COD'
  const hold = useLongPress(onHold)
  return (
    <li
      {...hold}
      className={cx(
        'grid select-none grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 [-webkit-touch-callout:none] sm:grid-cols-[auto_minmax(0,1fr)_auto]',
        selected && 'bg-v2-brand-soft',
      )}
    >
      <div className="flex items-start gap-3">
        <input type="checkbox" aria-label={`Pick ${o.contactName ?? 'this order'}`} checked={selected} onChange={onToggle} className="mt-2 size-5 cursor-pointer accent-v2-brand" />
        <span className="grid min-w-[4.5rem] place-items-center rounded-v2-md bg-v2-surface-2 px-2 py-1.5 text-center">
          {o.handoverPoint ? (
            <span className="max-w-[7rem] truncate text-[12px] font-semibold" title={o.handoverPoint}>
              {o.handoverPoint}
            </span>
          ) : (
            <Seat coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
          )}
        </span>
      </div>

      <Link href={`/v2/orders/${o.id}`} className={cx('min-w-0 rounded-v2-sm', v2Focus)}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold">{o.contactName ?? 'Passenger'}</span>
          <Chip tone={status.tone}>{status.label}</Chip>
          {showOutlet && o.outletName ? <span className="text-xs text-v2-muted">{o.outletName}</span> : null}
          <KitchenNoteHint count={o.callNoteCount} hint={o.callNoteHint} />
        </span>
        <span className="mt-1 flex items-start gap-1.5 text-[14.5px] leading-snug text-v2-ink-2">
          <KitchenDietMarks diet={o.diet} className="mt-1" />
          <span className="min-w-0">
            <DishList items={o.itemNames} note={o.note} max={3} />
          </span>
        </span>
        {o.note ? <span className="mt-1.5 block rounded-v2-sm bg-v2-info-bg px-2 py-1 text-[13.5px] font-semibold text-v2-info">Note: {o.note}</span> : null}
      </Link>

      <span className="col-start-2 sm:col-start-auto sm:text-right">
        {cash && o.amountPaise == null ? (
          <Chip tone="bad">Cash, amount missing</Chip>
        ) : cash ? (
          <span className="inline-flex flex-col items-start gap-0.5 sm:items-end">
            <span className="text-[12px] font-semibold text-v2-cod">Collect cash</span>
            <Mono className="text-[17px] font-bold">{formatRupees(o.amountPaise)}</Mono>
          </span>
        ) : (
          <span className="inline-flex flex-col items-start gap-0.5 sm:items-end">
            <span className="text-[12px] font-semibold text-v2-ok">Paid online</span>
            <Mono className="text-[15px] font-semibold text-v2-muted">{formatRupees(o.amountPaise)}</Mono>
          </span>
        )}
      </span>
    </li>
  )
}
