'use client'

import { useActionState, useCallback, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, cx, v2Focus } from './ui'
import { WorkspaceDialog } from './WorkspaceDialog'

/*
 * Form furniture for the order workspace. Every control here posts to an
 * existing server action through useActionState and reports the result
 * beside the button; dialogs carry the reason field when an action needs one.
 */

export type FormState = { error?: string; ok?: string }
export type FormAction<S extends FormState = FormState> = (prev: S, formData: FormData) => Promise<S>

const initial: FormState = {}

export const inputV2 = cx(
  'h-10 w-full rounded-v2-md border border-v2-line-strong bg-v2-surface px-3 text-sm text-v2-ink placeholder:text-v2-faint disabled:opacity-50',
  v2Focus,
)
export const textareaV2 = cx(
  'w-full rounded-v2-md border border-v2-line-strong bg-v2-surface px-3 py-2 text-sm text-v2-ink placeholder:text-v2-faint disabled:opacity-50',
  v2Focus,
)
export const checkboxV2 = 'size-4 shrink-0 rounded border-v2-line-strong accent-v2-brand'

export function FormNote({ state, className }: { state: FormState; className?: string }) {
  if (state.error) {
    return (
      <span role="alert" className={cx('text-xs font-semibold text-v2-bad', className)}>
        {state.error}
      </span>
    )
  }
  if (state.ok) {
    return (
      <span role="status" className={cx('text-xs font-semibold text-v2-ok', className)}>
        {state.ok}
      </span>
    )
  }
  return null
}

export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-v2-ink-2">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-v2-muted">{hint}</p> : null}
    </div>
  )
}

/** A submit button that knows its own form is in flight. */
export function SubmitButton({ children, pendingLabel, ...rest }: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || rest.disabled} aria-busy={pending || undefined} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}

/** Hidden fields, from a plain object. */
export function Hidden({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  )
}

/** One button, one server action, the result beside it. */
export function ActionButton({
  action,
  fields,
  variant = 'secondary',
  size = 'md',
  className,
  children,
}: {
  action: FormAction
  fields: Record<string, string>
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string
  children: ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, initial)
  return (
    <form action={formAction} className={cx('inline-flex flex-wrap items-center gap-2', className)}>
      <Hidden fields={fields} />
      <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending || undefined}>
        {children}
      </Button>
      <FormNote state={state} />
    </form>
  )
}

/** Prefills, not a fixed list: a tap fills the box and hands it back. */
export function QuickChips({ reasons, onPick }: { reasons: readonly string[]; onPick: (r: string) => void }) {
  if (reasons.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onPick(r)}
          className={cx(
            'rounded-full border border-v2-line bg-v2-surface px-2.5 py-1 text-xs font-medium text-v2-ink-2 transition-colors hover:bg-v2-surface-2 hover:text-v2-ink',
            v2Focus,
          )}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

/**
 * A button that opens a confirm dialog before posting. `reason` adds the
 * textarea (required unless `reasonOptional`) with quick-reason chips; every
 * terminal or destructive action on the workspace goes through here.
 */
export function ConfirmActionButton({
  action,
  fields,
  label,
  title,
  description,
  submitLabel,
  cancelLabel = 'Keep it',
  variant = 'secondary',
  submitVariant,
  size = 'md',
  reason = false,
  reasonOptional = false,
  reasonLabel = 'Why',
  reasonHint,
  quickReasons = [],
  extra,
  className,
}: {
  action: FormAction
  fields: Record<string, string>
  label: ReactNode
  title: ReactNode
  description?: ReactNode
  submitLabel: ReactNode
  cancelLabel?: string
  variant?: ComponentProps<typeof Button>['variant']
  submitVariant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  reason?: boolean
  reasonOptional?: boolean
  reasonLabel?: string
  reasonHint?: ReactNode
  quickReasons?: readonly string[]
  /** More inputs inside the dialog's form. */
  extra?: ReactNode
  className?: string
}) {
  const [requested, setRequested] = useState(false)
  const [state, formAction, pending] = useActionState(action, initial)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const id = useId()

  // Derived: once the action succeeded the dialog has nothing left to say.
  const open = requested && !state.ok
  const close = useCallback(() => setRequested(false), [])
  const danger = (submitVariant ?? variant) === 'danger'

  function prefill(r: string) {
    const field = reasonRef.current
    if (!field) return
    field.value = r
    field.focus()
    field.setSelectionRange(r.length, r.length)
  }

  return (
    <span className={cx('inline-flex flex-wrap items-center gap-2', className)}>
      <Button type="button" variant={variant} size={size} onClick={() => setRequested(true)}>
        {label}
      </Button>
      {/* Reported on the page too, so a failure is not lost with the dialog. */}
      <FormNote state={state} />

      {open ? (
        <WorkspaceDialog title={title} titleId={`${id}-title`} onClose={close} danger={danger}>
          <form id={`${id}-form`} action={formAction} className="grid gap-3">
            <Hidden fields={fields} />
            {description ? <p className="text-v2-muted">{description}</p> : null}
            {reason ? (
              <>
                <QuickChips reasons={quickReasons} onPick={prefill} />
                <Field label={reasonLabel} htmlFor={`${id}-reason`} hint={reasonHint}>
                  <textarea
                    ref={reasonRef}
                    id={`${id}-reason`}
                    name="reason"
                    required={!reasonOptional}
                    minLength={reasonOptional ? undefined : 3}
                    maxLength={500}
                    rows={3}
                    placeholder="What happened?"
                    className={textareaV2}
                  />
                </Field>
              </>
            ) : null}
            {extra}
            <FormNote state={state} />
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" form={`${id}-form`} variant={submitVariant ?? variant} disabled={pending} aria-busy={pending || undefined}>
              {submitLabel}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              {cancelLabel}
            </Button>
          </div>
        </WorkspaceDialog>
      ) : null}
    </span>
  )
}
