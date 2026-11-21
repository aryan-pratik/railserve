'use client'

import { useActionState, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Check, ChevronDown, Copy, Loader2, MessageSquareText, RefreshCw } from 'lucide-react'
import type { OrderDiet } from '@/lib/diet'
import { Button, VegMark, cx, v2Focus } from './ui'
import { checkTrainV2, type KitchenActionState } from '@/app/v2/kitchen/actions'

/*
 * Small client pieces the kitchen board shares between the desk card, the
 * footer actions and the wall: a submit button that knows it is pending, the
 * one confirm dialog, a copy button, the veg marks and the action note.
 */

/** A submit button that disables itself while its form's action is in flight. */
export function KitchenSubmit({ children, className, ...rest }: ComponentProps<typeof Button>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} aria-busy={pending || undefined} className={className} {...rest}>
      {pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  )
}

/** The action's one-line outcome, under the button that caused it. */
export function ActionNote({ state, className, dark = false }: { state: KitchenActionState; className?: string; dark?: boolean }) {
  if (state.error) return <span role="alert" className={cx('text-xs font-semibold', dark ? 'text-[#ff6b5e]' : 'text-v2-bad', className)}>{state.error}</span>
  if (state.ok) return <span role="status" className={cx('text-xs font-semibold', dark ? 'text-v2-mint' : 'text-v2-brand', className)}>{state.ok}</span>
  return null
}

/**
 * A question, a sentence of context, two buttons. Escape cancels, focus lands
 * inside and goes back to the opener, the page behind cannot scroll.
 */
export function KitchenConfirm({
  title,
  titleId,
  children,
  actions,
  onCancel,
  dark = false,
}: {
  title: ReactNode
  titleId: string
  children: ReactNode
  actions: ReactNode
  onCancel: () => void
  dark?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-v2-ink/50 p-4" onClick={onCancel}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'w-full max-w-sm rounded-v2-lg border p-5 shadow-v2-pop outline-none [overscroll-behavior:contain]',
          dark ? 'border-white/10 bg-[#151d19] text-white' : 'border-v2-line bg-v2-surface text-v2-ink',
        )}
      >
        <h3 id={titleId} className="text-[17px] font-bold tracking-[-0.01em] text-balance">
          {title}
        </h3>
        <div className={cx('mt-2 text-sm text-pretty', dark ? 'text-white/75' : 'text-v2-muted')}>{children}</div>
        <div className="mt-4 flex gap-2">{actions}</div>
      </div>
    </div>
  )
}

/** Copies `text` and flashes a tick so the person has proof it worked. */
export function KitchenCopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; nothing useful to recover into.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={copied ? 'Copied' : label}
      className={cx(
        'grid h-8 w-8 place-items-center rounded-full text-v2-muted transition-colors hover:bg-v2-surface-2 hover:text-v2-ink',
        v2Focus,
        className,
      )}
    >
      {copied ? <Check size={15} className="text-v2-brand" aria-hidden /> : <Copy size={15} aria-hidden />}
    </button>
  )
}

const DIET_TITLE: Record<Exclude<OrderDiet, null>, string> = {
  VEG: 'Veg',
  NON_VEG: 'Non-veg',
  MIXED: 'Veg + non-veg: prints two KOTs',
  UNTAGGED: 'Has an item with no veg / non-veg tag',
  NON_VEG_UNTAGGED: 'Has non-veg, and an item with no tag: prints two KOTs',
}

/** One order's veg marks: both shapes when it carries both, a "?" when something is untagged. */
export function KitchenDietMarks({ diet, className }: { diet: OrderDiet; className?: string }) {
  if (!diet) return null
  return (
    <span className={cx('inline-flex shrink-0 items-center', className)} title={DIET_TITLE[diet]}>
      {diet === 'VEG' || diet === 'MIXED' ? <VegMark diet="VEG" /> : null}
      {diet === 'NON_VEG' || diet === 'MIXED' || diet === 'NON_VEG_UNTAGGED' ? <VegMark diet="NON_VEG" /> : null}
      {diet === 'UNTAGGED' || diet === 'NON_VEG_UNTAGGED' ? (
        <span className="mr-1 font-mono text-xs font-bold text-v2-warn" aria-label="Not tagged">
          ?
        </span>
      ) : null}
    </span>
  )
}

/** "This order has been called about": the count, with the notes on hover. */
export function KitchenNoteHint({ count, hint }: { count: number; hint: string | null }) {
  if (count < 1 || !hint) return null
  return (
    <span title={hint} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold tabular-nums text-v2-info">
      <MessageSquareText size={12} aria-hidden />
      <span aria-hidden>{count}</span>
      <span className="sr-only">
        {count} call note{count === 1 ? '' : 's'}
      </span>
    </span>
  )
}

/**
 * "Check now" for the train in the run header: one cache row serves every
 * order riding it, so any order id on the run will do. Round, like the copy
 * button next to it; the outcome shows as a title and a short note.
 */
export function KitchenCheckNowButton({ orderId, className }: { orderId: string; className?: string }) {
  const [state, action, pending] = useActionState(checkTrainV2, {})
  return (
    <form action={action} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="orderId" value={orderId} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        aria-label="Check this train now"
        title={state.error ?? 'Ask the railway now instead of waiting for the next check'}
        className={cx(
          'grid h-8 w-8 place-items-center rounded-full text-v2-muted transition-colors hover:bg-v2-surface-2 hover:text-v2-ink disabled:opacity-60',
          v2Focus,
          className,
        )}
      >
        <RefreshCw size={15} className={pending ? 'animate-spin' : undefined} aria-hidden />
      </button>
      {state.error ? (
        <span role="alert" className="max-w-[12rem] truncate text-[11px] font-semibold text-v2-bad" title={state.error}>
          {state.error}
        </span>
      ) : null}
    </form>
  )
}

/*
 * Folding a run's rows. Per board, sessionStorage keeps a default for every
 * run ("open" or "folded" after Expand all / Collapse all, else the run's own
 * default) plus the runs that deviate from it, so the 30-second refresh and a
 * reload keep what was folded away; a new tab starts afresh. The folds read
 * that one store through useSyncExternalStore and change together.
 */

const FOLD_EVENT = 'v2:run-fold'
type FoldStore = { mode: 'open' | 'folded' | null; except: string[] }

function readStore(scope: string): FoldStore {
  try {
    const raw = sessionStorage.getItem(`v2.folded.${scope}`)
    const v = raw ? (JSON.parse(raw) as Partial<FoldStore>) : null
    return { mode: v?.mode ?? null, except: Array.isArray(v?.except) ? v.except : [] }
  } catch {
    return { mode: null, except: [] }
  }
}

function writeStore(scope: string, v: FoldStore) {
  try {
    sessionStorage.setItem(`v2.folded.${scope}`, JSON.stringify(v))
  } catch {
    // Storage blocked; the folds still move for this render.
  }
  window.dispatchEvent(new Event(FOLD_EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(FOLD_EVENT, cb)
  return () => window.removeEventListener(FOLD_EVENT, cb)
}

function isOpen(scope: string, runKey: string, defaultOpen: boolean): boolean {
  const v = readStore(scope)
  const base = v.mode === 'folded' ? false : v.mode === 'open' ? true : defaultOpen
  return v.except.includes(runKey) ? !base : base
}

/** Open state for one run, remembered per board across refreshes. */
export function useRunFold(scope: string, runKey: string, defaultOpen = true): [boolean, (open: boolean) => void] {
  // The server renders the run's default; the stored fold applies on the client.
  const open = useSyncExternalStore(
    subscribe,
    () => isOpen(scope, runKey, defaultOpen),
    () => defaultOpen,
  )
  const setOpen = (next: boolean) => {
    const v = readStore(scope)
    const base = v.mode === 'folded' ? false : v.mode === 'open' ? true : defaultOpen
    const except = v.except.filter((k) => k !== runKey)
    if (next !== base) except.push(runKey)
    writeStore(scope, { mode: v.mode, except })
  }
  return [open, setOpen]
}

/** Fold or unfold every run on a board. */
export function setAllRunFolds(scope: string, open: boolean) {
  writeStore(scope, { mode: open ? 'open' : 'folded', except: [] })
}

/** The chevron in a run header's actions that folds its rows away. */
export function RunFoldButton({ open, onToggle, controls, className }: { open: boolean; onToggle: () => void; controls: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? 'Hide the orders on this train' : 'Show the orders on this train'}
      title={open ? 'Collapse' : 'Expand'}
      className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted transition-colors hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus, className)}
    >
      <ChevronDown size={17} aria-hidden className={cx('transition-transform', open ? 'rotate-180' : '')} />
    </button>
  )
}
