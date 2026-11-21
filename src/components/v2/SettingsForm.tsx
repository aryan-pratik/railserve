import type { ReactNode } from 'react'
import { cx, v2Focus } from './ui'

/*
 * Form furniture for the Settings dialogs and inline controls. No hooks, so
 * both server and client components can compose from here.
 */

export const inputClass = cx(
  'h-10 w-full min-w-0 rounded-v2-md border border-v2-line-strong bg-v2-surface px-3 text-sm text-v2-ink placeholder:text-v2-faint disabled:bg-v2-surface-2 disabled:text-v2-muted',
  v2Focus,
)

// The chevron is inline so a select looks like every other field; spaces in
// the data URI are %20-encoded because an arbitrary Tailwind value ends at a space.
export const selectClass = cx(
  inputClass,
  'appearance-none bg-no-repeat pr-9 bg-[position:right_0.7rem_center]',
  'bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2716%27%20height=%2716%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2366716b%27%20stroke-width=%272.2%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")]',
)

export const textareaClass = cx(
  'w-full min-w-0 rounded-v2-md border border-v2-line-strong bg-v2-surface px-3 py-2 text-sm text-v2-ink placeholder:text-v2-faint',
  v2Focus,
)

export const checkboxClass = 'size-4 shrink-0 rounded border-v2-line-strong accent-v2-brand'

/** A compact select for inline controls in tables and cards. */
export const inlineSelectClass = cx(selectClass, 'h-9 w-auto max-w-full text-[13px]')

export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('grid min-w-0 gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-v2-ink-2">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-v2-muted">{hint}</p> : null}
    </div>
  )
}

/** A checkbox with a title and a line of explanation, as one bordered row. */
export function CheckRow({
  name,
  title,
  note,
  defaultChecked,
  value = 'true',
}: {
  name: string
  title: ReactNode
  note?: ReactNode
  defaultChecked?: boolean
  value?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-v2-md border border-v2-line px-3 py-2.5 hover:bg-v2-surface-2">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className={cx(checkboxClass, 'mt-0.5')} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        {note ? <span className="block text-xs text-v2-muted">{note}</span> : null}
      </span>
    </label>
  )
}

/** The outcome of an action, beside its button. */
export function FormNote({ state, className }: { state: { error?: string; ok?: string }; className?: string }) {
  if (state.error) {
    return (
      <p role="alert" className={cx('text-[13px] font-medium text-v2-bad', className)}>
        {state.error}
      </p>
    )
  }
  if (state.ok) {
    return (
      <p role="status" className={cx('text-[13px] font-medium text-v2-ok', className)}>
        {state.ok}
      </p>
    )
  }
  return null
}
