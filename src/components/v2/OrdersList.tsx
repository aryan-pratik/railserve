'use client'

import { useActionState, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Printer, Check, Bike, ThumbsUp } from 'lucide-react'
import { CallNoteHint } from '@/components/CallNoteHint'
import { ORDER_TYPE_LABEL, sourceLabel, type OrderType } from '@/lib/orderEnums'
import { formatRupees } from '@/lib/format'
import { BULK_ACTIONS, bulkPick, isLive, type BulkKind } from '@/lib/v2/ordersShared'
import { bulkOrdersAction, type BulkState } from '@/app/v2/orders/actions'
import { Button, Chip, Mono, Seat, VegMark, cx, statusChip, v2Focus } from './ui'
import { Table, TableFrame, Td, Th, rowClass, Sub } from './Table'
import { Countdown } from './Countdown'
import { RunHeader, type RunHeaderProps } from './RunHeader'
import { useRunFold } from './KitchenBits'
import { useLongPress } from './useLongPress'
import { DishList } from './DishList'
import { OrdersStatusPopover } from './OrdersStatusPopover'

/** One order as the table lists it. Plain values only: this crosses to the client. */
export type OrdersRow = {
  id: string
  runKey: string
  externalOrderId: string
  orderType: string
  source: string | null
  /** "14:20", when the order was placed. */
  placedLabel: string
  /** "Mon 07 Sep"; set on views that span dates. */
  dateLabel: string | null
  diet: string | null
  callNoteCount: number
  callNoteHint: string | null
  trainNo: string | null
  trainName: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  handoverPoint: string | null
  contactName: string | null
  phoneMasked: string | null
  outletName: string | null
  status: string
  /** Live or booked arrival, ISO; the countdown ticks against it while the order is open. */
  etaIso: string | null
  arrived: boolean
  /** The booked time as text, for closed orders where a countdown would be a frozen guess. */
  bookedLabel: string | null
  amountPaise: number | null
  /** Money paid back, if any; the order keeps its status. */
  refundPaise: number | null
  /** A decoy placed only to get an app-store rating. */
  ratingOrder: boolean
  paymentMode: string | null
  rider: string | null
  pax: number | null
  /** One label per dish, as the kitchen list shows them. */
  itemNames: string[]
  /** The instruction for the kitchen: KOT note, else remark. */
  note: string | null
}

export type OrdersGroup = {
  header: Omit<RunHeaderProps, 'serverNowMs' | 'actions' | 'href'>
  rows: OrdersRow[]
}

export type OrdersListProps = {
  mode: 'flat' | 'grouped'
  rows: OrdersRow[]
  groups: OrdersGroup[]
  serverNowMs: number
  columns: { outlet: boolean; amount: boolean; called: boolean; date: boolean; orderNo: boolean }
  /** Tick boxes and the bulk bar; only for roles whose actions exist (admin, store). */
  canBulk: boolean
  /** The inline status override; admin only. */
  canOverride: boolean
  statusOptions: string[]
  riders: { id: string; name: string }[]
  /** Below the rows: the pager. */
  footer?: ReactNode
}

const INITIAL: BulkState = {}

/**
 * The orders table, flat or grouped by train. One selection spans the whole
 * page in either mode, so an admin can tick three bags on two trains and hand
 * them to one rider; the bar at the bottom groups them by run on the way out.
 */
export function OrdersList(p: OrdersListProps) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const all = useMemo(() => (p.mode === 'flat' ? p.rows : p.groups.flatMap((g) => g.rows)), [p.mode, p.rows, p.groups])
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all])
  // Rows leave the page after an action or a refresh; a tick on one of them must not keep counting.
  const selected = useMemo(() => new Set([...picked].filter((id) => byId.has(id))), [picked, byId])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const setMany = (ids: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const cols = { ...p.columns, select: p.canBulk, compact: false }

  return (
    <>
      {p.mode === 'flat' ? (
        <TableFrame>
          <OrdersTable rows={p.rows} cols={cols} selected={selected} toggle={toggle} setMany={setMany} list={p} />
          {p.footer}
        </TableFrame>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {p.groups.map((g) => (
            <TrainGroup key={g.header.trainLabel + g.header.stationCode + g.rows[0]?.runKey} group={g} list={p} cols={cols} selected={selected} toggle={toggle} setMany={setMany} />
          ))}
          {p.footer ? <TableFrame>{p.footer}</TableFrame> : null}
        </div>
      )}

      {p.canBulk && selected.size > 0 ? (
        <BulkBar rows={[...selected].map((id) => byId.get(id)!)} riders={p.riders} onClear={() => setPicked(new Set())} />
      ) : null}
    </>
  )
}

type Cols = OrdersListProps['columns'] & { select: boolean; compact: boolean }

/**
 * One order inside a train card, laid out as on the kitchen list: seat, who,
 * what to cook, how it is paid. Tap opens the order; tick or hold to pick it
 * for the action bar.
 */
function TrainOrderRow({ o, cols, selected, onToggle }: { o: OrdersRow; cols: Cols; selected: boolean; onToggle: () => void }) {
  const hold = useLongPress(() => (selected ? undefined : onToggle()))
  const status = statusChip(o.status)
  const cash = o.paymentMode === 'COD'
  return (
    <li
      {...(cols.select ? hold : {})}
      className={cx(
        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
        cols.select && 'select-none [-webkit-touch-callout:none]',
        selected && 'bg-v2-brand-soft',
      )}
    >
      <div className="flex items-start gap-3">
        {cols.select ? (
          <input type="checkbox" aria-label={`Pick ${o.contactName ?? 'this order'}`} checked={selected} onChange={onToggle} className="mt-2 size-5 cursor-pointer accent-v2-brand" />
        ) : null}
        <span className="grid min-w-[4.5rem] place-items-center rounded-v2-md bg-v2-surface-2 px-2 py-1.5 text-center">
          {o.handoverPoint ? (
            <span className="max-w-[7rem] truncate text-[12px] font-semibold" title={o.handoverPoint}>
              Group
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
          {cols.outlet && o.outletName ? <span className="text-xs text-v2-muted">{o.outletName}</span> : null}
          {o.rider ? <span className="text-xs text-v2-muted">· with {o.rider}</span> : null}
        </span>
        <span className="mt-1 block text-[14.5px] leading-snug text-v2-ink-2">
          <DishList items={o.itemNames} note={o.note} max={3} />
        </span>
        {o.handoverPoint ? <span className="mt-0.5 block text-[12.5px] font-semibold text-v2-ink-2">Hand over at: {o.handoverPoint}</span> : null}
        {o.note ? <span className="mt-1.5 block rounded-v2-sm bg-v2-info-bg px-2 py-1 text-[13.5px] font-semibold text-v2-info">Note: {o.note}</span> : null}
      </Link>
      {cols.amount ? (
        <span className="col-start-2 sm:col-start-auto sm:text-right">
          {cash ? (
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
          {o.refundPaise ? <span className="mt-1 block text-[12px] font-semibold text-v2-bad">Refunded {formatRupees(o.refundPaise)}</span> : null}
        </span>
      ) : null}
    </li>
  )
}

/** A table row you can also press and hold to tick, as on the kitchen list. */
function HoldRow({
  onHold,
  className,
  onClick,
  children,
}: {
  onHold: (() => void) | null
  className?: string
  onClick: (e: MouseEvent<HTMLTableRowElement>) => void
  children: ReactNode
}) {
  const hold = useLongPress(() => onHold?.())
  return (
    <tr {...(onHold ? hold : {})} className={cx(className, onHold && 'select-none [-webkit-touch-callout:none]')} onClick={onClick}>
      {children}
    </tr>
  )
}

/**
 * One train in the grouped list, foldable like the kitchen's: the header
 * always shows, the orders under it open and close. A train whose orders are
 * all finished starts folded, so the list opens on the trains still moving.
 */
function TrainGroup({
  group: g,
  list: p,
  cols,
  selected,
  toggle,
  setMany,
}: {
  group: OrdersListProps['groups'][number]
  list: OrdersListProps
  cols: Cols
  selected: Set<string>
  toggle: (id: string) => void
  setMany: (ids: string[], on: boolean) => void
}) {
  const key = g.rows[0]?.runKey ?? g.header.trainLabel
  const allDone = g.rows.every((r) => !isLive(r.status) && r.status !== 'DISPATCHED')
  const [open, setOpen] = useRunFold('orders', key, !allDone)
  const rowsId = `orders-run-${key.replace(/[^a-zA-Z0-9]/g, '-')}`
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-v2-xl border border-v2-line bg-v2-surface shadow-[0_1px_2px_rgba(16,24,20,0.04),0_10px_28px_-16px_rgba(16,24,20,0.18)]">
      <RunHeader
        className={cx('!rounded-none !border-x-0 !border-t-0', open ? '!border-b !border-v2-line' : '!border-b-0')}
        {...g.header}
        serverNowMs={p.serverNowMs}
        fold={{ open, onToggle: () => setOpen(!open), controls: rowsId }}
        actions={
          p.canBulk && open ? (
            <Button size="sm" variant="ghost" onClick={() => setMany(g.rows.map((r) => r.id), !g.rows.every((r) => selected.has(r.id)))}>
              {g.rows.every((r) => selected.has(r.id)) ? 'Untick train' : 'Tick train'}
            </Button>
          ) : null
        }
      />
      <ul id={rowsId} hidden={!open} className="divide-y divide-v2-line">
        {g.rows.map((o) => (
          <TrainOrderRow key={o.id} o={o} cols={cols} selected={selected.has(o.id)} onToggle={() => toggle(o.id)} />
        ))}
      </ul>
    </section>
  )
}

function OrdersTable({
  rows,
  cols,
  selected,
  toggle,
  setMany,
  list,
}: {
  rows: OrdersRow[]
  cols: Cols
  selected: Set<string>
  toggle: (id: string) => void
  setMany: (ids: string[], on: boolean) => void
  list: OrdersListProps
}) {
  const router = useRouter()
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someOn = rows.some((r) => selected.has(r.id))

  // A click on the row opens the order; clicks on its own controls do not.
  const openRow = (e: MouseEvent<HTMLTableRowElement>, id: string) => {
    const t = e.target as HTMLElement
    if (t.closest('a,button,input,select,label,[role="dialog"]')) return
    router.push(`/v2/orders/${id}`)
  }

  return (
    <Table className={cols.compact ? 'min-w-[860px]' : 'min-w-[1080px]'}>
      <thead>
        <tr>
          {cols.select ? (
            <Th className="w-10">
              <input
                type="checkbox"
                aria-label="Select every order on this page"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = someOn && !allOn
                }}
                onChange={(e) => setMany(rows.map((r) => r.id), e.target.checked)}
                className="size-4 cursor-pointer accent-v2-brand"
              />
            </Th>
          ) : null}
          {cols.orderNo ? <Th>Order</Th> : null}
          {cols.compact ? null : <Th>Train</Th>}
          <Th>Seat</Th>
          <Th>Passenger</Th>
          <Th>Dishes</Th>
          {cols.outlet ? <Th>Outlet</Th> : null}
          <Th>Status</Th>
          {cols.compact ? null : <Th>Arrives</Th>}
          {cols.amount ? <Th align="right">Amount</Th> : null}
          {cols.called ? <Th>Called</Th> : null}
          <Th>Rider</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => {
          const chip = statusChip(o.status)
          const on = selected.has(o.id)
          const href = `/v2/orders/${o.id}`
          return (
            <HoldRow key={o.id} className={rowClass(on, true)} onClick={(e) => openRow(e, o.id)} onHold={cols.select ? () => (on ? undefined : toggle(o.id)) : null}>
              {cols.select ? (
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Select order ${o.externalOrderId}`}
                    checked={on}
                    onChange={() => toggle(o.id)}
                    className="size-4 cursor-pointer accent-v2-brand"
                  />
                </Td>
              ) : null}
              {cols.orderNo ? (
              <Td>
                <span className="flex items-center gap-1.5">
                  <Link href={href} className={cx('rounded font-mono text-[13px] font-semibold hover:underline', v2Focus)}>
                    {o.externalOrderId}
                  </Link>
                  <CallNoteHint orderId={o.id} count={o.callNoteCount} hint={o.callNoteHint} />
                  {o.orderType !== 'RETAIL' ? <Chip tone="grey">{ORDER_TYPE_LABEL[o.orderType as OrderType] ?? o.orderType}</Chip> : null}
                  {o.diet === 'VEG' || o.diet === 'NON_VEG' ? (
                    <VegMark diet={o.diet} />
                  ) : o.diet === 'MIXED' || o.diet === 'NON_VEG_UNTAGGED' ? (
                    <span className="inline-flex">
                      <VegMark diet="VEG" />
                      <VegMark diet="NON_VEG" />
                    </span>
                  ) : null}
                </span>
                <Sub>
                  {[cols.date ? o.dateLabel : null, o.placedLabel, o.source ? sourceLabel(o.source) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Sub>
              </Td>
              ) : null}
              {cols.compact ? null : (
                <Td>
                  {o.trainNo ? (
                    <>
                      <Mono className="font-semibold">{o.trainNo}</Mono>
                      {o.trainName ? <Sub className="max-w-[14rem] truncate">{o.trainName}</Sub> : null}
                    </>
                  ) : (
                    <span className="text-v2-faint">{o.orderType === 'LOCAL' ? 'Local' : '—'}</span>
                  )}
                </Td>
              )}
              <Td>
                {o.handoverPoint ? (
                  <span className="inline-block max-w-[12rem] truncate text-xs font-medium" title={o.handoverPoint}>
                    {o.handoverPoint}
                  </span>
                ) : (
                  <Seat coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
                )}
              </Td>
              <Td>
                <span className="block max-w-[11rem] truncate font-medium">{o.contactName ?? <span className="text-v2-faint">—</span>}</span>
                {o.phoneMasked ? <Sub className="font-mono tabular-nums">{o.phoneMasked}</Sub> : null}
              </Td>
              <Td className="min-w-[14rem] max-w-[18rem] !whitespace-normal">
                <DishList items={o.itemNames} note={o.note} className="text-[13.5px] leading-snug" />
              </Td>
              {cols.outlet ? (
                <Td>
                  <span className="block max-w-[10rem] truncate text-v2-ink-2">{o.outletName ?? <span className="text-v2-faint">—</span>}</span>
                </Td>
              ) : null}
              <Td>
                <span className="inline-flex items-center gap-1">
                  <Chip tone={chip.tone}>{chip.label}</Chip>
                  {list.canOverride ? (
                    <OrdersStatusPopover orderId={o.id} externalOrderId={o.externalOrderId} current={o.status} options={list.statusOptions} />
                  ) : null}
                </span>
              </Td>
              {cols.compact ? null : (
                <Td>
                  {isLive(o.status) ? (
                    <Countdown targetIso={o.etaIso} arrived={o.arrived} serverNowMs={list.serverNowMs} />
                  ) : (
                    <Mono className="text-v2-muted">{o.bookedLabel ?? '—'}</Mono>
                  )}
                </Td>
              )}
              {cols.amount ? (
                <Td align="right">
                  {o.paymentMode === 'COD' && o.amountPaise == null ? (
                    <Chip tone="bad">COD · amount missing</Chip>
                  ) : (
                    <span className="inline-flex flex-col items-end gap-1">
                      <Mono className="font-semibold">{formatRupees(o.amountPaise)}</Mono>
                      {o.paymentMode === 'COD' ? <Chip tone="cod">Cash</Chip> : null}
                      {o.refundPaise ? <Chip tone="bad">Refunded {formatRupees(o.refundPaise)}</Chip> : null}
                      {o.ratingOrder ? <Chip tone="grey">Rating order</Chip> : null}
                    </span>
                  )}
                </Td>
              ) : null}
              {cols.called ? (
                <Td>{o.callNoteCount > 0 ? <Chip tone="ok">Called</Chip> : <Chip tone="grey">Not called</Chip>}</Td>
              ) : null}
              <Td>
                <span className="block max-w-[9rem] truncate text-v2-ink-2">{o.rider ?? <span className="text-v2-faint">—</span>}</span>
              </Td>
            </HoldRow>
          )
        })}
      </tbody>
    </Table>
  )
}

/**
 * The action bar that rises once something is ticked. It says what the
 * selection is made of, offers only the moves those orders can take (each
 * with its count, in pipeline order), and makes handing over a two-step:
 * pick the rider, then confirm. Escape clears the ticks.
 */
function BulkBar({ rows, riders, onClear }: { rows: OrdersRow[]; riders: { id: string; name: string }[]; onClear: () => void }) {
  // A success clears the ticks, which also takes this bar away.
  const [state, formAction, pending] = useActionState(async (prev: BulkState, fd: FormData) => {
    const result = await bulkOrdersAction(prev, fd)
    if (result.ok) onClear()
    return result
  }, INITIAL)
  const [handing, setHanding] = useState(false)
  const [riderId, setRiderId] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (handing) setHanding(false)
      else onClear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handing, onClear])

  const eligible = (kind: BulkKind) => rows.filter((r) => r.status === BULK_ACTIONS[kind].from)
  const steps: { kind: BulkKind; list: OrdersRow[]; label: string; Icon: typeof Check; why: string }[] = [
    { kind: 'accept', list: eligible('accept'), label: 'Accept', Icon: ThumbsUp, why: 'new orders' },
    { kind: 'kot', list: eligible('kot'), label: 'Print KOTs', Icon: Printer, why: 'accepted orders' },
    { kind: 'ready', list: eligible('ready'), label: 'Mark ready', Icon: Check, why: 'orders with a KOT' },
    { kind: 'hand', list: eligible('hand'), label: 'Hand to rider', Icon: Bike, why: 'ready orders' },
  ]
  const available = steps.filter((st) => st.list.length > 0)
  const hand = eligible('hand')

  // What the ticks are made of, in the words the board uses.
  const breakdown = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      const w = statusChip(r.status).label
      acc[w] = (acc[w] ?? 0) + 1
      return acc
    }, {}),
  )
    .map(([w, n]) => `${n} ${w.toLowerCase()}`)
    .join(' · ')

  const picks = (list: OrdersRow[]) => list.map((r) => <input key={r.id} type="hidden" name="pick" value={bulkPick(r.runKey, r.id)} />)
  const btn = cx(
    'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-white transition-colors disabled:opacity-40',
    'bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-mint',
  )
  const riderName = riders.find((r) => r.id === riderId)?.name

  return (
    <div
      role="region"
      aria-label="Selected orders"
      className="fixed bottom-5 left-1/2 z-40 w-[min(960px,calc(100vw-2rem))] -translate-x-1/2 rounded-v2-xl bg-[#0f1b16] p-3 text-white shadow-v2-pop ring-1 ring-white/10 lg:left-[calc(50%+108px)]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="rounded-full bg-v2-brand px-2.5 py-0.5 font-mono text-sm font-bold tabular-nums text-white">{rows.length}</span>
            <span className="text-sm font-bold">selected</span>
            <button type="button" onClick={onClear} className="rounded-full px-2 py-0.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">
              Clear · Esc
            </button>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-white/65">{breakdown}</p>
        </div>

        {handing ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="kind" value="hand" />
            {picks(hand)}
            <span className="text-xs font-semibold text-white/80">Who takes {hand.length === 1 ? 'this bag' : `these ${hand.length} bags`}?</span>
            <span role="radiogroup" aria-label="Rider" className="flex flex-wrap gap-1.5">
              {riders.length === 0 ? <span className="text-xs text-v2-soon">No active rider at this outlet</span> : null}
              {riders.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={riderId === r.id}
                  onClick={() => setRiderId(r.id)}
                  className={cx('h-8 rounded-full px-3 text-[13px] font-semibold transition-colors', riderId === r.id ? 'bg-v2-mint text-[#0f1b16] ring-2 ring-v2-mint/40' : 'bg-white/10 text-white hover:bg-white/20')}
                >
                  {r.name}
                </button>
              ))}
            </span>
            <input type="hidden" name="riderId" value={riderId} />
            <button type="button" onClick={() => setHanding(false)} className={btn}>
              Back
            </button>
            <button type="submit" disabled={pending || !riderId} className={cx(btn, 'bg-v2-brand hover:bg-v2-brand-hover')}>
              <Bike size={14} aria-hidden /> {pending ? 'Sending…' : riderName ? `On the way with ${riderName.split(/\s+/)[0]} (${hand.length})` : `On the way (${hand.length})`}
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {available.length === 0 ? (
              <span className="text-xs text-white/70">Nothing to move here: these orders are already out, delivered or closed.</span>
            ) : null}
            {available.map((st, i) =>
              st.kind === 'hand' ? (
                <button key={st.kind} type="button" onClick={() => setHanding(true)} disabled={pending} className={cx(btn, i === available.length - 1 && 'bg-v2-brand hover:bg-v2-brand-hover')}>
                  <st.Icon size={14} aria-hidden /> {st.label} ({st.list.length})
                </button>
              ) : (
                <form key={st.kind} action={formAction} className="contents">
                  <input type="hidden" name="kind" value={st.kind} />
                  {picks(st.list)}
                  <button type="submit" disabled={pending} title={`${st.list.length} ${st.why}`} className={cx(btn, i === available.length - 1 && 'bg-v2-brand hover:bg-v2-brand-hover')}>
                    <st.Icon size={14} aria-hidden /> {st.label} ({st.list.length})
                  </button>
                </form>
              ),
            )}
          </div>
        )}
      </div>
      {state.error || pending ? (
        <p className={cx('mt-2 text-xs font-semibold', state.error ? 'text-v2-soon' : 'text-white/70')} role={state.error ? 'alert' : 'status'}>
          {state.error ?? 'Working…'}
        </p>
      ) : null}
    </div>
  )
}
