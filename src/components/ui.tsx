import type { ComponentProps, ReactNode } from 'react'
import Link from 'next/link'

/* ── surfaces ─────────────────────────────────────────────────────────────── */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {action}
    </div>
  )
}

export function EmptyState({ title, note, action }: { title: string; note: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface p-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{note}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function PageHeader({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {note ? <p className="mt-0.5 text-sm text-muted">{note}</p> : null}
      </div>
      {action}
    </div>
  )
}

/* ── buttons ──────────────────────────────────────────────────────────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'go'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-sunken',
  ghost: 'text-muted hover:bg-sunken hover:text-ink',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  // The one action an agent takes with their thumb, on a platform, in a hurry.
  go: 'bg-emerald-600 text-white hover:bg-emerald-700',
}

const SIZE: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
}

/**
 * A focus ring that is actually visible.
 *
 * Offset so it reads against both the button's own fill and the row hover
 * behind it, and drawn in ink rather than accent so it stays visible on the
 * accent-filled primary variant. Keyboard-only, so pointer users never see it.
 */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function buttonClass(variant: Variant, size: Size, className: string) {
  return (
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    `${FOCUS_RING} ${VARIANT[variant]} ${SIZE[size]} ${className}`
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />
}

/* ── forms ────────────────────────────────────────────────────────────────── */

export const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none ' +
  'placeholder:text-faint disabled:bg-sunken disabled:text-faint ' +
  // ring-accent/20 composited to 1.39:1 against white — below the 3:1 that
  // SC 1.4.11 asks of a focus indicator, so the ring was decorative and a 1px
  // border change was carrying the whole signal. Full-opacity accent instead.
  'focus:border-accent focus:ring-2 focus:ring-accent'

export function Field({
  label, htmlFor, error, hint, children,
}: {
  label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}

/** Inline result of a server action. Every form reports success and failure the same way. */
export function FormNote({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <span className="text-sm font-medium text-red-600">{state.error}</span>
  if (state.ok) return <span className="text-sm font-medium text-emerald-700">{state.ok}</span>
  return null
}

/* ── badges ───────────────────────────────────────────────────────────────── */

/**
 * The single place order status becomes a colour.
 *
 * Ordered by pipeline position, cool to warm, so a glance down a list reads as
 * progress. Terminal states drop to neutral so they stop competing for
 * attention once nothing more can be done about them.
 */
const STATUS_STYLES: Record<string, string> = {
  ENQUIRY: 'bg-slate-100 text-slate-700 ring-slate-200',
  QUOTED: 'bg-sky-100 text-sky-800 ring-sky-200',
  RECEIVED: 'bg-blue-100 text-blue-800 ring-blue-200',
  ACCEPTED: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  KOT_PRINTED: 'bg-violet-100 text-violet-800 ring-violet-200',
  PREPARED: 'bg-amber-100 text-amber-900 ring-amber-200',
  DISPATCHED: 'bg-orange-100 text-orange-900 ring-orange-200',
  DELIVERED: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  FAILED: 'bg-red-100 text-red-800 ring-red-200',
  CANCELLED: 'bg-slate-200 text-slate-600 ring-slate-300',
  LOST: 'bg-slate-200 text-slate-600 ring-slate-300',
}

/** Short labels — the board shows these hundreds of times a day. */
const STATUS_LABEL: Record<string, string> = {
  KOT_PRINTED: 'KOT sent',
  PREPARED: 'Ready',
  DISPATCHED: 'On platform',
}

export function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ')
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
      }`}
    >
      {statusLabel(status)}
    </span>
  )
}

/** Bulk orders behave differently enough (pax, handover, thali spec) to flag. */
export function TypeBadge({ type }: { type: string }) {
  if (type !== 'BULK') return null
  return (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide ring-1 ring-inset bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200">
      BULK
    </span>
  )
}

/** The coach is what an agent walks the platform by, so it reads first. */
export function CoachChip({ coach, berth, size = 'md' }: { coach: string | null | undefined; berth?: string | null | undefined; size?: 'md' | 'lg' }) {
  if (!coach) return <span className="text-sm text-faint">—</span>
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className={`rounded bg-ink font-bold tabular-nums text-white ${
          size === 'lg' ? 'px-2.5 py-1 text-lg' : 'px-1.5 py-0.5 text-sm'
        }`}
      >
        {coach}
      </span>
      {berth ? (
        <span className={`font-semibold tabular-nums text-ink ${size === 'lg' ? 'text-lg' : 'text-sm'}`}>
          {berth}
        </span>
      ) : null}
    </span>
  )
}

/* ── tabs ─────────────────────────────────────────────────────────────────── */

export type Tab = { href: string; label: string; count?: number; active: boolean }

export function Tabs({ tabs }: { tabs: Tab[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
            t.active
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:border-line-strong hover:text-ink'
          }`}
        >
          {t.label}
          {t.count !== undefined ? (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                t.active ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted'
              }`}
            >
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  )
}
