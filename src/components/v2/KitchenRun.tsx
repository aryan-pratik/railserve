'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatRupees, formatTimeIST } from '@/lib/format'
import { kitchenOrderText, kitchenRunText, runAnchor, type KitchenOrder, type KitchenRun as KitchenRunData } from '@/lib/v2/kitchenView'
import { RunHeader } from './RunHeader'
import { Chip, Mono, Seat, cx, statusChip } from './ui'
import { Table, Td, Th, rowClass } from './Table'
import { KitchenCheckNowButton, KitchenCopyButton, KitchenDietMarks, KitchenNoteHint, RunFoldButton, useRunFold } from './KitchenBits'
import { KitchenRunActions, type RunActionContext } from './KitchenRunActions'

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
  const someTicked = run.orders.some((o) => selected.has(o.id))

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
    run.leaveByIso && !run.arrived ? `leave by ${formatTimeIST(run.leaveByIso)}` : null,
    run.codTotalPaise > 0 ? `${formatRupees(run.codTotalPaise)} COD` : null,
    !open ? `${run.orders.length} order${run.orders.length === 1 ? '' : 's'} hidden` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section id={runAnchor(run.key)} className="grid scroll-mt-4 gap-1.5 rounded-v2-lg target:ring-2 target:ring-v2-brand target:ring-offset-4 target:ring-offset-v2-surface" aria-label={`${run.trainLabel} ${run.trainName ?? ''}`}>
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
        actions={
          <span className="flex items-center gap-0.5">
            {!run.local && run.trainNo && run.orders[0] ? <KitchenCheckNowButton orderId={run.orders[0].id} /> : null}
            <KitchenCopyButton text={kitchenRunText(run)} label="Copy train details" />
            <RunFoldButton open={open} onToggle={() => setOpen(!open)} controls={rowsId} />
          </span>
        }
      />
      <div id={rowsId} hidden={!open} className="min-w-0 overflow-x-auto rounded-v2-lg border border-v2-line bg-v2-surface">
        <Table className="min-w-[56rem]">
          <thead>
            <tr>
              <Th className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select every order on this train"
                  checked={allTicked}
                  ref={(el) => {
                    if (el) el.indeterminate = someTicked && !allTicked
                  }}
                  onChange={(e) => setAll(e.target.checked)}
                  className="size-4 cursor-pointer accent-v2-brand"
                />
              </Th>
              <Th>Order</Th>
              <Th>Seat</Th>
              <Th>Passenger</Th>
              <Th>Items</Th>
              <Th align="right">Amount</Th>
              <Th>Status</Th>
              <Th>Placed</Th>
              {showOutlet ? <Th>Outlet</Th> : null}
              <Th className="w-10">
                <span className="sr-only">Copy</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {run.orders.map((o) => (
              <OrderRow key={o.id} o={o} run={run} selected={selected.has(o.id)} onToggle={() => toggle(o.id)} showOutlet={showOutlet} />
            ))}
          </tbody>
        </Table>
        <div className="border-t border-v2-line bg-v2-surface-2 px-3.5 py-2.5">
          <KitchenRunActions
            run={ctx}
            counts={run.statusCounts}
            ticked={run.orders.filter((o) => selected.has(o.id)).map((o) => ({ id: o.id, status: o.status }))}
            onClear={clear}
          />
        </div>
      </div>
    </section>
  )
}

function OrderRow({
  o,
  run,
  selected,
  onToggle,
  showOutlet,
}: {
  o: KitchenOrder
  run: KitchenRunData
  selected: boolean
  onToggle: () => void
  showOutlet: boolean
}) {
  const status = statusChip(o.status)
  const isNew = o.status === 'RECEIVED'
  return (
    <tr className={rowClass(selected)}>
      <Td>
        <input type="checkbox" aria-label={`Select order ${o.externalOrderId}`} checked={selected} onChange={onToggle} className="size-4 cursor-pointer accent-v2-brand" />
      </Td>
      <Td>
        <span className="flex items-center gap-1.5">
          {isNew ? <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-v2-info" title="Not accepted yet" aria-label="New" /> : null}
          <Link href={`/v2/orders/${o.id}`} className="font-mono text-xs font-semibold text-v2-brand underline-offset-2 hover:underline">
            {o.externalOrderId}
          </Link>
          <KitchenNoteHint count={o.callNoteCount} hint={o.callNoteHint} />
        </span>
        <span className="block text-[11px] text-v2-faint">{o.orderType === 'TRAIN' ? null : o.orderType.toLowerCase()}</span>
      </Td>
      <Td>
        {o.handoverPoint ? (
          <span className="inline-block max-w-[12rem] truncate text-xs font-semibold text-v2-ink-2" title={o.handoverPoint}>
            {o.orderType === 'LOCAL' ? 'Deliver to' : 'Handover'}: {o.handoverPoint}
          </span>
        ) : (
          <Seat coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
        )}
      </Td>
      <Td>
        <span className="block max-w-[12rem] truncate font-semibold">{o.contactName ?? <span className="text-v2-faint">—</span>}</span>
        {o.contactPhone ? <Mono className="block text-[11px] text-v2-muted">{o.contactPhone}</Mono> : null}
      </Td>
      <Td className="max-w-[20rem]">
        <span className="flex items-start gap-1 whitespace-normal leading-snug">
          <KitchenDietMarks diet={o.diet} className="mt-1" />
          <span className="min-w-0">
            {o.pax ? (
              <span className="font-semibold">{o.pax} pax thali</span>
            ) : o.itemNames.length > 0 ? (
              <span title={o.itemNames.join('\n')}>{o.itemNames.join(', ')}</span>
            ) : (
              <span className="text-v2-faint">No items</span>
            )}
          </span>
        </span>
        {o.note ? (
          <span className="mt-0.5 block whitespace-normal text-xs font-semibold text-v2-info" title={o.note}>
            Note: {o.note}
          </span>
        ) : null}
      </Td>
      <Td align="right">
        {o.paymentMode === 'COD' && o.amountPaise == null ? (
          <Chip tone="bad">COD · amount missing</Chip>
        ) : (
          <span className="inline-flex flex-col items-end gap-1">
            <Mono className="font-semibold">{formatRupees(o.amountPaise)}</Mono>
            {o.paymentMode === 'COD' ? <Chip tone="cod">COD</Chip> : null}
          </span>
        )}
      </Td>
      <Td>
        <Chip tone={status.tone}>{status.label}</Chip>
      </Td>
      <Td>
        <Mono className="text-xs text-v2-muted">{o.placedLabel}</Mono>
      </Td>
      {showOutlet ? (
        <Td>
          <span className="block max-w-[10rem] truncate text-xs text-v2-muted" title={o.outletName ?? undefined}>
            {o.outletName ?? '—'}
          </span>
        </Td>
      ) : null}
      <Td className={cx('px-1')}>
        <KitchenCopyButton text={kitchenOrderText(o, run)} label="Copy order details" />
      </Td>
    </tr>
  )
}
