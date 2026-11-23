import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

/*
 * v2 primitives. Pill buttons, soft chips, white cards with a 1px line and
 * no shadow (only floating things get shadows), mono for anything the railway
 * issues. Every v2 screen composes from here; nothing styles a control inline.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export const v2Focus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-brand focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'dark'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-v2-brand text-white border-v2-brand hover:bg-v2-brand-hover',
  secondary: 'bg-v2-surface text-v2-ink border-v2-line-strong hover:bg-v2-surface-2',
  ghost: 'bg-transparent text-v2-ink-2 border-transparent hover:bg-v2-surface-2',
  soft: 'bg-v2-brand-soft text-v2-brand border-transparent hover:bg-v2-mint/50',
  danger: 'bg-v2-surface text-v2-bad border-v2-bad hover:bg-v2-bad-bg',
  dark: 'bg-v2-ink text-v2-bg border-v2-ink hover:opacity-90',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-[15px] gap-2',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cx(
    'inline-flex shrink-0 items-center justify-center rounded-full border font-semibold leading-none whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none',
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    v2Focus,
    extra,
  )
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />
}

type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'cod' | 'grey' | 'out'

const CHIP_TONE: Record<ChipTone, string> = {
  ok: 'bg-v2-ok-bg text-v2-ok',
  warn: 'bg-v2-warn-bg text-v2-warn',
  bad: 'bg-v2-bad-bg text-v2-bad',
  info: 'bg-v2-info-bg text-v2-info',
  cod: 'bg-v2-cod-bg text-v2-cod',
  grey: 'bg-v2-surface-2 text-v2-ink-2 ring-1 ring-inset ring-v2-line',
  // The one filled chip: the order that is moving.
  out: 'bg-v2-brand-deep text-white',
}

export function Chip({ tone = 'grey', className, children }: { tone?: ChipTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold leading-4',
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Order status → chip tone and the words the board uses. */
export function statusChip(status: string): { tone: ChipTone; label: string } {
  switch (status) {
    case 'RECEIVED':
      return { tone: 'info', label: 'New' }
    case 'ACCEPTED':
      return { tone: 'warn', label: 'Accepted' }
    case 'KOT_PRINTED':
      return { tone: 'warn', label: 'Cooking' }
    case 'PREPARED':
      return { tone: 'ok', label: 'Ready' }
    case 'DISPATCHED':
      return { tone: 'out', label: 'With rider' }
    case 'DELIVERED':
      return { tone: 'ok', label: 'Delivered' }
    case 'FAILED':
      return { tone: 'bad', label: 'Not delivered' }
    case 'CANCELLED':
      return { tone: 'bad', label: 'Cancelled' }
    case 'LOST':
      return { tone: 'grey', label: 'Not booked' }
    case 'ENQUIRY':
      return { tone: 'grey', label: 'Enquiry' }
    case 'QUOTED':
      return { tone: 'info', label: 'Quoted' }
    default:
      return { tone: 'grey', label: status.replace(/_/g, ' ').toLowerCase() }
  }
}

export function Card({
  title,
  action,
  className,
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cx('grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3.5 rounded-v2-lg border border-v2-line bg-v2-surface p-[18px]', className)}>
      {title || action ? (
        <header className="flex items-center justify-between gap-3">
          {title ? <h3 className="text-[17px] font-bold tracking-[-0.01em]">{title}</h3> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function Mono({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx('font-mono tabular-nums', className)}>{children}</span>
}

/** Coach and berth as the board shows them: "B4·31" in a sunken mono block. */
export function Seat({ coach, berth, rawSeat }: { coach?: string | null; berth?: string | null; rawSeat?: string | null }) {
  const text = coach ? `${coach}${berth ? `·${berth}` : ''}` : rawSeat
  if (!text) return <span className="text-v2-faint">—</span>
  return <span className="rounded-md bg-v2-sunken px-1.5 py-px font-mono text-[12.5px] font-semibold tabular-nums">{text}</span>
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('text-[11px] font-bold uppercase tracking-[0.12em] text-v2-muted', className)}>{children}</span>
}

/** Initials in a round tile; the avatar the product has until people upload one. */
export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-v2-mint to-v2-brand font-extrabold text-white', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
      aria-hidden
    >
      {initials || '?'}
    </span>
  )
}

export function VegMark({ diet }: { diet: 'VEG' | 'NON_VEG' | null | undefined }) {
  if (!diet) return null
  const colour = diet === 'VEG' ? 'border-v2-ok before:bg-v2-ok' : 'border-v2-bad before:bg-v2-bad'
  return (
    <span
      className={cx(
        'relative mr-1 inline-block h-2.5 w-2.5 border-[1.5px] align-middle before:absolute before:inset-[2px] before:rounded-full',
        colour,
      )}
      aria-label={diet === 'VEG' ? 'Veg' : 'Non-veg'}
    />
  )
}
