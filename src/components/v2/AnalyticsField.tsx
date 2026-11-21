import Link from 'next/link'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cx, v2Focus } from './ui'
import { Select as Dropdown } from './Select'

/*
 * Form controls for the v2 filter cards (Analytics, Activity, Menu). Pills
 * like the buttons, one height, no inline styling anywhere else. Server-safe:
 * the auto-submitting select lives in AnalyticsAutoSelect.tsx.
 */

export const fieldClass = cx(
  'h-10 w-full min-w-0 rounded-full border border-v2-line bg-v2-surface px-3.5 text-sm text-v2-ink placeholder:text-v2-faint disabled:opacity-50',
  v2Focus,
)

export function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cx('grid min-w-0 gap-1', className)}>
      <span className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-v2-muted">{label}</span>
      {children}
    </label>
  )
}

/** The filter-card dropdown: the shared Select in this card's pill shape. */
export type FieldSelectProps = Omit<ComponentProps<typeof Dropdown>, 'size' | 'submitOnChange'>

export function Select(props: FieldSelectProps) {
  return <Dropdown {...props} />
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(fieldClass, className)} {...rest} />
}

/** An active filter as a chip with a cross; the href removes it. */
export function FilterChip({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full bg-v2-brand-soft pl-3 pr-2 text-[12.5px] font-semibold text-v2-brand hover:bg-v2-mint/50',
        v2Focus,
      )}
    >
      <span className="font-medium text-v2-brand/70">{label}</span>
      {value}
      <X size={13} strokeWidth={2.4} aria-label={`Remove ${label.toLowerCase()} filter`} />
    </Link>
  )
}
