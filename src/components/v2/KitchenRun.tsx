'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatRupees, formatTimeIST } from '@/lib/format'
import { kitchenRunText, runAnchor, type KitchenOrder, type KitchenRun as KitchenRunData } from '@/lib/v2/kitchenView'
import { TrainCard } from './TrainCard'
import { RunOrdersTable, type RunTableRow } from './RunOrdersTable'
import { KitchenCheckNowButton, KitchenCopyButton, useRunFold } from './KitchenBits'
import { KitchenOrderStep, KitchenRunActions, type RunActionContext } from './KitchenRunActions'

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
    <TrainCard
      id={runAnchor(run.key)}
      label={`${run.trainLabel} ${run.trainName ?? ''}`}
      open={open}
      onToggle={() => setOpen(!open)}
      bodyId={rowsId}
      actions={<TrainTools run={run} />}
      header={{
        trainLabel: run.trainLabel,
        trainName: run.local ? 'Local orders' : run.trainName,
        stationCode: run.stationCode,
        startDateLabel: run.startDateLabel,
        trackingNote: run.trackingNote,
        etaIso: run.etaIso,
        bookedIso: run.bookedIso,
        platform: run.platform,
        delayMinutes: run.delayMinutes,
        arrived: run.arrived,
        serverNowMs,
        counts: run.counts,
        summary: summary || null,
      }}
    >
        <RunOrdersTable
          rows={run.orders.map(toRow)}
          trainText={`${run.trainLabel} ${run.trainName ?? ''}`.trim()}
          selected={selected}
          onToggle={toggle}
          onToggleAll={setAll}
          showOutlet={showOutlet}
          action={(o) => <KitchenOrderStep run={ctx} orderId={o.id} status={o.status} />}
        />
        {/* The step for the whole train, after its orders: read them, then act. Each
            row also has its own button for one order. */}
        {/* The train's button only when it saves taps: two or more orders on the
            same next step, or some ticked. One order is done from its own row. */}
        {selected.size > 0 || sameStepCount(run.orders) > 1 ? (
        <div className="border-t border-v2-line bg-v2-surface-2 px-4 py-3">
          <KitchenRunActions
            run={ctx}
            counts={run.statusCounts}
            ticked={run.orders.filter((o) => selected.has(o.id)).map((o) => ({ id: o.id, status: o.status }))}
            onClear={clear}
          />
          <p className="mt-1.5 text-[12.5px] text-v2-muted">
            {selected.size > 0 ? 'This button acts on the ticked orders only.' : 'This button acts on the whole train. For one order, use the button on its row.'}{' '}
            <button type="button" className="font-semibold text-v2-brand underline-offset-2 hover:underline" onClick={() => setAll(!allTicked)}>
              {allTicked ? 'Untick all' : 'Tick all'}
            </button>
          </p>
        </div>
        ) : null}
    </TrainCard>
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

/** A kitchen order in the shared train table's shape. */
function toRow(o: KitchenOrder): RunTableRow {
  return {
    id: o.id,
    externalOrderId: o.externalOrderId,
    source: o.source,
    status: o.status,
    contactName: o.contactName,
    phone: o.contactPhone,
    coach: o.coach,
    berth: o.berth,
    rawSeat: o.rawSeat,
    handoverPoint: o.handoverPoint,
    diet: o.diet,
    itemNames: o.itemNames,
    note: o.note,
    amountPaise: o.amountPaise,
    paymentMode: o.paymentMode,
    placedLabel: o.placedLabel,
    outletName: o.outletName,
    callNoteCount: o.callNoteCount,
    callNoteHint: o.callNoteHint,
  }
}

/** How many orders share the train's next step (the earliest one any order is on). */
function sameStepCount(orders: { status: string }[]): number {
  for (const st of ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED']) {
    const n = orders.filter((o) => o.status === st).length
    if (n > 0) return n
  }
  return 0
}
