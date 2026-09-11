import type { ComponentProps, ReactNode } from 'react'
import Link from 'next/link'
import { IconArrowLeft, IconChevronLeft, IconChevronRight } from './Icons'
import { LinkHint } from './LinkHint'
import { Spinner } from './Spinner'
import { EMPTY } from '@/lib/format'

export { Spinner }

/*
 * The shared vocabulary of every screen.
 *
 * Surfaces, buttons, inputs, badges, tabs and the empty/loading/error states
 * live here so that a control looks the same on the admin board, the kitchen
 * board and the rider's phone. A page that needs something this file does
 * not have should add it here, not style a one-off.
 */

/* ── focus ────────────────────────────────────────────────────────────────── */

/**
 * The one focus ring. Drawn in accent with an offset so it reads on a filled
 * button, a white card and a hovered row alike. Keyboard-only, so pointer
 * users never see it.
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

/** Same ring, drawn inside the element, for rows and cells that have no room around them. */
export const focusRingInset =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent'

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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {action}
    </div>
  )
}

export function EmptyState({ title, note, action }: { title: string; note: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface p-10 text-center">
      <p className="font-medium text-ink text-balance">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted text-pretty">{note}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

/**
 * Every screen opens with this: a title, an optional line under it, and the
 * screen's actions on the right. Badges next to the title (an order's status,
 * its type) go in `badges` so they sit on the title's baseline rather than
 * being improvised into the title string.
 */
export function PageHeader({
  title,
  badges,
  note,
  action,
  back,
}: {
  title: ReactNode
  badges?: ReactNode
  note?: ReactNode
  action?: ReactNode
  /** A way back to the list this detail screen came from. */
  back?: { href: string; label: string }
}) {
  return (
    <div className="space-y-2">
      {back ? <BackLink href={back.href}>{back.label}</BackLink> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* Capped at a readable measure. Unbounded, a one-sentence note runs the
            full width of a 1400px console and pushes the action onto its own
            line, where it lands flush left and aligns to nothing. */}
        <div className="min-w-0 max-w-[68ch]">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-ink text-balance">{title}</h1>
            {badges}
          </div>
          {note ? <p className="mt-1 text-sm leading-relaxed text-muted text-pretty">{note}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}

/** "All orders", "Back to the board": the link at the top of a detail screen. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-lg py-1 pr-2 text-sm font-medium text-muted transition-colors hover:text-ink ${focusRing}`}
    >
      <IconArrowLeft size={15} aria-hidden />
      {children}
    </Link>
  )
}

/* ── notices ──────────────────────────────────────────────────────────────── */

type Tone = 'info' | 'warn' | 'danger' | 'success'

const NOTICE: Record<Tone, string> = {
  info: 'bg-sunken text-ink ring-line-strong',
  warn: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
}

/**
 * A sentence the operator needs to read before trusting the screen: the feed
 * is down, ingestion has stalled, these times are simulated. Tinted by tone,
 * never by a coloured left border.
 */
export function Notice({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset text-pretty ${NOTICE[tone]} ${className}`}
    >
      {children}
    </div>
  )
}

/* ── stats ────────────────────────────────────────────────────────────────── */

/**
 * One instrument panel, not a row of free-floating cards. Divided columns
 * keep the strip full-width however many figures it carries, so its right
 * edge lines up with whatever table sits below it.
 */
export function StatStrip({ children, columns }: { children: ReactNode; columns: 2 | 3 | 4 | 5 }) {
  const cols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-3 lg:grid-cols-5',
  }[columns]
  return (
    <Card className={`grid divide-y divide-line sm:divide-x sm:divide-y-0 ${cols}`}>
      {children}
    </Card>
  )
}

export function Stat({
  label,
  value,
  note,
  tone = 'text-ink',
}: {
  label: string
  value: string
  note?: string | null
  /** Text colour class for the figure. Accent for the one present-tense number, red for a loss. */
  tone?: string
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</div>
      {/* Reserved height so a strip with and without notes lines up. */}
      <div className="mt-1 h-4 text-xs text-faint">{note}</div>
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
  danger: 'border border-red-300 bg-surface text-red-700 hover:bg-red-50',
  // The one action an agent takes with their thumb, on a platform, in a hurry.
  go: 'bg-emerald-600 text-white hover:bg-emerald-700',
}

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-12 px-4 text-base',
}

function buttonClass(variant: Variant, size: Size, className: string) {
  return (
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap ' +
    'transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
    `${focusRing} ${VARIANT[variant]} ${SIZE[size]} ${className}`
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  pending = false,
  disabled,
  children,
  ...props
}: ComponentProps<'button'> & {
  variant?: Variant
  size?: Size
  /** The request has started: disable, and show a spinner beside the label. */
  pending?: boolean
}) {
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Spinner size={size === 'lg' ? 18 : 14} /> : null}
      {children}
    </button>
  )
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />
}

/**
 * A button that is a plain anchor rather than a Link.
 *
 * For hrefs the router must not intercept: a file download, or anything
 * leaving the app. Routing a CSV route handler client-side navigates the page
 * to it instead of saving a file, so the distinction is load-bearing.
 */
export function ButtonAnchor({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<'a'> & { variant?: Variant; size?: Size }) {
  return <a {...props} className={buttonClass(variant, size, className)} />
}

/**
 * A square button holding one icon. `aria-label` is required, not optional:
 * an icon-only control with no name is unusable by a screen reader and
 * un-hoverable on a phone.
 */
export function IconButton({
  'aria-label': label,
  size = 'md',
  className = '',
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'aria-label'> & { 'aria-label': string; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={props.title ?? label}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'size-7' : 'size-9'
      } ${focusRing} ${className}`}
    >
      {children}
    </button>
  )
}

/* ── forms ────────────────────────────────────────────────────────────────── */

/** An input or select at its natural width: for toolbars, where it sits beside other controls. */
export const inputBase =
  'h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none ' +
  'placeholder:text-faint disabled:bg-sunken disabled:text-faint ' +
  'focus:border-accent focus:ring-2 focus:ring-accent'

/** The same, filling its column: for forms laid out in a grid. */
export const inputClass = `w-full ${inputBase}`

/** Same border and focus treatment for anything taller than one line. */
export const textareaClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none ' +
  'placeholder:text-faint disabled:bg-sunken disabled:text-faint ' +
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
      {hint && !error ? <p className="mt-1 text-xs text-muted text-pretty">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}

/** Inline result of a server action. Every form reports success and failure the same way. */
export function FormNote({ state, className = '' }: { state: { error?: string; ok?: string }; className?: string }) {
  if (state.error) {
    return (
      <span role="alert" className={`text-sm font-medium text-red-600 ${className}`}>
        {state.error}
      </span>
    )
  }
  if (state.ok) {
    return (
      <span role="status" className={`text-sm font-medium text-emerald-700 ${className}`}>
        {state.ok}
      </span>
    )
  }
  return null
}

/**
 * A row of exclusive choices: Today / Upcoming, All time / This month.
 * One control, one shape, wherever it appears.
 */
export const segmentedClass =
  'inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-sunken/60 p-0.5'

export function segmentClass(active: boolean) {
  return (
    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap ' +
    `transition-colors ${focusRing} ${
      active ? 'bg-surface text-ink font-semibold shadow-2xs' : 'text-muted hover:text-ink'
    }`
  )
}

/* ── tables ───────────────────────────────────────────────────────────────── */

/** Column header for every table. Left-aligned by default; add text-right for numbers. */
export const thClass = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted'

/** What an empty cell shows. */
export function Dash() {
  return <span className="text-faint">{EMPTY}</span>
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

/** Short labels: the board shows these hundreds of times a day. */
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
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
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

/** A payment mode as a pill. COD is loud because it is cash a rider must collect. */
export function PaymentBadge({ mode, amount }: { mode: string | null | undefined; amount?: string }) {
  if (!mode) return <Dash />
  const cod = mode === 'COD'
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide ring-1 ring-inset ${
        cod ? 'bg-amber-100 text-amber-900 ring-amber-200' : 'bg-sunken text-muted ring-line-strong'
      }`}
    >
      {cod ? 'COD' : mode.charAt(0) + mode.slice(1).toLowerCase()}
      {amount ? <span className="ml-1 tabular-nums">{amount}</span> : null}
    </span>
  )
}

/** The coach is what an agent walks the platform by, so it reads first. */
export function CoachChip({
  coach,
  berth,
  rawSeat,
  size = 'md',
}: {
  coach: string | null | undefined
  berth?: string | null | undefined
  rawSeat?: string | null | undefined
  size?: 'md' | 'lg'
}) {
  if (!coach) {
    // coach/berth failed to parse out of the ingested text — rawSeat still
    // holds the original string (e.g. "RAC/B2, SEAT: 39"), show that instead
    // of a bare dash so the seat isn't silently dropped from list views.
    return rawSeat ? <span className="font-mono text-sm text-ink">{rawSeat}</span> : <Dash />
  }
  return (
    // Wraps rather than overflows: a berth dropping to a second line is
    // readable, a coach code painted across the next column is not.
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1 gap-y-0.5">
      <span
        className={`max-w-full truncate rounded bg-ink font-bold tabular-nums text-white ${
          size === 'lg' ? 'px-2.5 py-1 text-lg' : 'px-1.5 py-0.5 text-sm'
        }`}
        title={coach}
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

/* ── pagination ───────────────────────────────────────────────────────────── */

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

/** One arrow in the pager. No `href` means "there is no such page" — rendered inert, not linked. */
function PageNavLink({ href, label, children }: { href?: string; label: string; children: ReactNode }) {
  const className = `inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors ${
    href ? `hover:bg-sunken hover:text-ink ${focusRing}` : 'cursor-not-allowed opacity-50'
  }`
  if (!href) {
    return (
      <span aria-hidden="true" className={className}>
        {children}
      </span>
    )
  }
  return (
    <Link href={href} aria-label={label} className={className}>
      {children}
    </Link>
  )
}

/**
 * Page-number-and-size control for a server-rendered list. `buildHref` gets
 * the destination page/size and returns the full URL, so the caller can fold
 * in whatever filters are already in play — this component knows nothing
 * about them.
 */
export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
}: {
  page: number
  pageSize: number
  total: number
  buildHref: (target: { page: number; pageSize: number }) => string
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted tabular-nums">
          {total === 0 ? 'No results' : `${from}–${to} of ${total}`}
        </span>
        <div className={segmentedClass}>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <Link
              key={size}
              href={buildHref({ page: 1, pageSize: size })}
              aria-current={size === pageSize ? 'true' : undefined}
              className={segmentClass(size === pageSize)}
            >
              {size}
            </Link>
          ))}
        </div>
      </div>

      <nav aria-label="Pages" className="flex items-center gap-1">
        <PageNavLink
          href={page > 1 ? buildHref({ page: page - 1, pageSize }) : undefined}
          label="Previous page"
        >
          <IconChevronLeft size={16} />
        </PageNavLink>
        <span className="px-1.5 text-xs font-medium text-muted tabular-nums whitespace-nowrap">
          Page {page} of {totalPages}
        </span>
        <PageNavLink
          href={page < totalPages ? buildHref({ page: page + 1, pageSize }) : undefined}
          label="Next page"
        >
          <IconChevronRight size={16} />
        </PageNavLink>
      </nav>
    </div>
  )
}

/* ── tabs ─────────────────────────────────────────────────────────────────── */

export type Tab = { href: string; label: string; count?: number; active: boolean }

export function Tabs({
  tabs,
  label = 'Sections',
  action,
}: {
  tabs: Tab[]
  label?: string
  /** Controls that belong on the same line as the tabs, at the right. */
  action?: ReactNode
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${focusRingInset} ${
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
          <LinkHint />
        </Link>
      ))}
      {action ? <div className="ml-auto flex flex-wrap items-center gap-2 pb-1.5">{action}</div> : null}
    </nav>
  )
}
