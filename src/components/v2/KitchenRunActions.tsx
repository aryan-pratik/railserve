'use client'

import { useActionState, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Printer } from 'lucide-react'
import { shouldWarnAboutDelay } from '@/lib/train/policy'
import { formatTimeIST } from '@/lib/format'
import { formatDelay } from '@/lib/v2/kitchenView'
import { acceptRunV2, generateRunKotV2, handRunToRiderV2, markRunPreparedV2, type KitchenActionState } from '@/app/v2/kitchen/actions'
import { Select } from './Select'
import { Button, cx, v2Focus } from './ui'
import { ActionNote, KitchenConfirm, KitchenSubmit } from './KitchenBits'
import { KitchenReprintButton } from './KitchenReprintButton'

const initial: KitchenActionState = {}

type Rider = { id: string; name: string }

/** Everything the actions need to know about the train they are moving. */
export type RunActionContext = {
  runKey: string
  trainLabel: string
  delayMinutes: number | null
  etaIso: string | null
  delayThresholdMinutes: number
  riders: Rider[]
  kotHref: string
}

/** The ticked orders, posted as `orderId` so the action moves only those. */
function SelectedIds({ ids }: { ids: string[] }) {
  return ids.map((id) => <input key={id} type="hidden" name="orderId" value={id} />)
}

/**
 * Print, with the delay guard. The guard asks, it never blocks: the system
 * does not know how long the dish keeps or how full the pass is.
 */
function PrintForm({
  run,
  ids,
  count,
  label,
  onDone,
  size,
  className,
  dark,
  variant = 'primary',
}: {
  run: RunActionContext
  ids: string[]
  count: number
  label: string
  onDone?: () => void
  size: 'sm' | 'md' | 'lg'
  className?: string
  dark?: boolean
  /** The row buttons are quieter than the train's one big step. */
  variant?: 'primary' | 'secondary'
}) {
  const [state, action] = useActionState(generateRunKotV2, initial)
  const [confirming, setConfirming] = useState(false)
  const late = shouldWarnAboutDelay(run.delayMinutes, run.delayThresholdMinutes)

  useEffect(() => {
    if (state.ok) onDone?.()
  }, [state, onDone])

  const form = (
    <form action={action} className="contents">
      <input type="hidden" name="runKey" value={run.runKey} />
      <SelectedIds ids={ids} />
      <KitchenSubmit variant={variant} size={size} className={className}>
        <Printer size={size === 'lg' ? 18 : 15} aria-hidden />
        {label}
      </KitchenSubmit>
    </form>
  )

  if (!late) {
    return (
      <>
        {form}
        <ActionNote state={state} dark={dark} />
      </>
    )
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setConfirming(true)}>
        <Printer size={size === 'lg' ? 18 : 15} aria-hidden />
        {label}
      </Button>
      <ActionNote state={state} dark={dark} />
      {confirming ? (
        <KitchenConfirm
          titleId={`kot-delay-${run.runKey}`}
          title={
            <>
              <span className="font-mono">{run.trainLabel}</span> is running late
            </>
          }
          onCancel={() => setConfirming(false)}
          dark={dark}
          actions={
            <>
              <form action={action} className="flex-1" onSubmit={() => setConfirming(false)}>
                <input type="hidden" name="runKey" value={run.runKey} />
                <SelectedIds ids={ids} />
                <KitchenSubmit variant="primary" className="w-full">
                  Print anyway
                </KitchenSubmit>
              </form>
              <Button type="button" variant={dark ? 'ghost' : 'secondary'} className={dark ? 'border-white/20 text-white hover:bg-white/10' : undefined} onClick={() => setConfirming(false)}>
                Wait
              </Button>
            </>
          }
        >
          Running <strong className={dark ? 'text-white' : 'text-v2-ink'}>{formatDelay(run.delayMinutes ?? 0)}</strong> late
          {run.etaIso ? (
            <>
              , now expected <strong className={cx('font-mono tabular-nums', dark ? 'text-white' : 'text-v2-ink')}>{formatTimeIST(run.etaIso)}</strong>
            </>
          ) : null}
          . Print {count} KOT{count === 1 ? '' : 's'} anyway? The food will sit until the train arrives.
        </KitchenConfirm>
      ) : null}
    </>
  )
}

const SELECT_CLASS = 'min-w-[11rem] border-v2-line-strong font-medium'
// Important: the Select's own surface classes sit later in the stylesheet, so a plain override loses.
const DARK_SELECT_CLASS = '!border-white/20 !bg-[#1b2622] !text-white'

/** Food is on the shelf: name who took it, then it is on the way. */
function HandForm({
  run,
  ids,
  count,
  onDone,
  size,
  dark,
  variant = 'primary',
}: {
  run: RunActionContext
  ids: string[]
  count: number
  onDone?: () => void
  size: 'sm' | 'md' | 'lg'
  dark?: boolean
  /** The row buttons are quieter than the train's one big step. */
  variant?: 'primary' | 'secondary'
}) {
  const [state, action] = useActionState(handRunToRiderV2, initial)
  const [riderId, setRiderId] = useState('')
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (state.ok) onDone?.()
  }, [state, onDone])

  if (run.riders.length === 0) {
    return <span className={cx('text-xs font-semibold', dark ? 'text-white/70' : 'text-v2-muted')}>{count} ready, but no rider is working at this outlet. Add one under Riders.</span>
  }
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-2"
      // The old native select was `required`; the hidden input a Select writes
      // skips browser validation, so the same guard lives here.
      onSubmit={(e) => {
        if (!riderId) {
          e.preventDefault()
          setMissing(true)
        }
      }}
    >
      <input type="hidden" name="runKey" value={run.runKey} />
      <SelectedIds ids={ids} />
      <Select
        id={`rider-${run.runKey}-${ids[0] ?? 'all'}`}
        name="riderId"
        aria-label="Rider taking it"
        // A row's own button is small: "Rider" fits where "Choose a rider" would be cut.
        placeholder={size === 'sm' ? 'Rider' : 'Choose a rider'}
        value={riderId}
        onChange={(v) => {
          setRiderId(v)
          setMissing(false)
        }}
        className="w-auto"
        buttonClassName={cx(SELECT_CLASS, size === 'lg' && 'h-12 text-base', dark && DARK_SELECT_CLASS, missing && 'border-v2-bad')}
        options={run.riders.map((r) => ({ value: r.id, label: r.name }))}
      />
      <KitchenSubmit variant={variant} size={size}>
        Give {count > 1 ? `${count} orders ` : ''}to rider
      </KitchenSubmit>
      {missing ? (
        <span role="alert" className={cx('text-xs font-semibold', dark ? 'text-[#ff6b5e]' : 'text-v2-bad')}>
          Choose a rider first.
        </span>
      ) : (
        <ActionNote state={state} dark={dark} />
      )}
    </form>
  )
}

function StepForm({
  action: serverAction,
  run,
  ids,
  label,
  onDone,
  size,
  className,
  dark,
  variant = 'primary',
}: {
  action: typeof acceptRunV2
  run: RunActionContext
  ids: string[]
  label: ReactNode
  onDone?: () => void
  size: 'sm' | 'md' | 'lg'
  className?: string
  dark?: boolean
  /** The row buttons are quieter than the train's one big step. */
  variant?: 'primary' | 'secondary'
}) {
  const [state, action] = useActionState(serverAction, initial)
  useEffect(() => {
    if (state.ok) onDone?.()
  }, [state, onDone])
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="runKey" value={run.runKey} />
      <SelectedIds ids={ids} />
      <KitchenSubmit variant={variant} size={size} className={className}>
        {label}
      </KitchenSubmit>
      <ActionNote state={state} dark={dark} />
    </form>
  )
}

/**
 * The desk footer: whole-train actions, or the ticked orders' actions when
 * any rows are ticked. Only the step the run is actually waiting on is the
 * primary; preview and reprint sit behind the overflow.
 */
export function KitchenRunActions({
  run,
  counts,
  ticked,
  onClear,
}: {
  run: RunActionContext
  counts: Record<string, number>
  ticked: { id: string; status: string }[]
  onClear: () => void
}) {
  const narrowed = ticked.length > 0
  const n = (status: string) => (narrowed ? ticked.filter((o) => o.status === status).length : (counts[status] ?? 0))
  const ids = ticked.map((o) => o.id)
  const which = narrowed ? ' selected' : ''

  const toAccept = n('RECEIVED')
  const toPrint = n('ACCEPTED')
  const toReady = n('KOT_PRINTED')
  const waiting = n('PREPARED')
  const printed = counts.KOT_PRINTED ?? 0
  const previewable = (counts.ACCEPTED ?? 0) + printed

  // The pipeline step this run (or this selection) is on. Earlier steps win:
  // a train with orders waiting to be accepted is waiting to be accepted.
  const step = toAccept > 0 ? 'accept' : toPrint > 0 ? 'print' : toReady > 0 ? 'ready' : waiting > 0 ? 'hand' : null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {narrowed ? (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-v2-brand">
          {ticked.length} selected
          <button type="button" onClick={onClear} className={cx('rounded px-1 text-v2-muted underline-offset-2 hover:text-v2-ink hover:underline', v2Focus)}>
            Clear
          </button>
        </span>
      ) : null}

      {step === 'accept' ? (
        <StepForm action={acceptRunV2} run={run} ids={ids} size="md" onDone={onClear} label={`Accept ${toAccept}${which} order${toAccept === 1 ? '' : 's'}`} />
      ) : null}
      {step === 'print' ? (
        <PrintForm run={run} ids={ids} count={toPrint} size="md" onDone={onClear} label={`Print ${toPrint}${which} KOT${toPrint === 1 ? '' : 's'} (kitchen ticket${toPrint === 1 ? '' : 's'})`} />
      ) : null}
      {step === 'ready' ? (
        <StepForm action={markRunPreparedV2} run={run} ids={ids} size="md" onDone={onClear} label={`Food ready (${toReady}${which})`} />
      ) : null}
      {step === 'hand' ? <HandForm run={run} ids={ids} count={waiting} size="md" onDone={onClear} /> : null}

      {step === null ? (
        <span className="text-[13.5px] text-v2-muted">
          {narrowed ? 'Nothing to do for the orders you ticked.' : 'Nothing to do in the kitchen for this train.'}
        </span>
      ) : null}

      {/* Further steps behind this one, so the manager can see what follows without three buttons competing. */}
      {step === 'accept' && toPrint + toReady + waiting > 0 ? (
        <span className="text-[13px] text-v2-muted">
          Also: {[toPrint ? `${toPrint} to print` : null, toReady ? `${toReady} cooking` : null, waiting ? `${waiting} ready on the shelf` : null].filter(Boolean).join(', ')}
        </span>
      ) : null}

      {previewable > 0 ? (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Labelled, not behind "⋯": a mystery menu next to the order buttons looked like a copy of them. */}
          <Link href={run.kotHref} className={cx('inline-flex h-8 items-center rounded-full border border-v2-line px-3 text-[13px] font-semibold text-v2-ink-2 hover:bg-v2-surface-2', v2Focus)}>
            Preview {previewable} KOT{previewable === 1 ? '' : 's'}
          </Link>
          {printed > 0 ? <KitchenReprintButton runKey={run.runKey} count={printed} /> : null}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The KOT preview page's own print button: the same guarded print as the
 * board footer, for the whole run, so a manager who came to look does not
 * have to go back to the board to send.
 */
export function KitchenPrintButton({ run, count }: { run: RunActionContext; count: number }) {
  return <PrintForm run={run} ids={[]} count={count} size="md" label={`Print ${count} KOT${count === 1 ? '' : 's'}`} />
}

/**
 * The wall's one big pill per ticket. Same actions, scoped to that order.
 */
export function KitchenTicketAction({ run, order }: { run: RunActionContext; order: { id: string; status: string } }) {
  const ids = [order.id]
  const big = 'h-12 w-full text-[17px]'
  switch (order.status) {
    case 'RECEIVED':
      return <StepForm action={acceptRunV2} run={run} ids={ids} size="lg" className={big} label="Accept" dark />
    case 'ACCEPTED':
      return (
        <div className="grid gap-1">
          <PrintForm run={run} ids={ids} count={1} size="lg" className={big} label="Print KOT" dark />
        </div>
      )
    case 'KOT_PRINTED':
      return <StepForm action={markRunPreparedV2} run={run} ids={ids} size="lg" className={big} label="Ready" dark />
    case 'PREPARED':
      return <HandForm run={run} ids={ids} count={1} size="lg" dark />
    default:
      return null
  }
}

/**
 * One order's own next step, on its row: accept it, print its ticket, mark
 * it ready, or give it to a rider, without ticking it first. The train's
 * button at the bottom of the card still acts on all of them at once.
 */
export function KitchenOrderStep({ run, orderId, status }: { run: RunActionContext; orderId: string; status: string }) {
  const ids = [orderId]
  if (status === 'RECEIVED') return <StepForm action={acceptRunV2} run={run} ids={ids} size="sm" variant="secondary" label="Accept" />
  if (status === 'ACCEPTED') return <PrintForm run={run} ids={ids} count={1} size="sm" variant="secondary" label="Print KOT" />
  if (status === 'KOT_PRINTED') return <StepForm action={markRunPreparedV2} run={run} ids={ids} size="sm" variant="secondary" label="Food ready" />
  if (status === 'PREPARED') return <HandForm run={run} ids={ids} count={1} size="sm" variant="secondary" />
  return null
}
