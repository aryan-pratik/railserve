'use client'

import { useActionState, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, cx, v2Focus } from './ui'
import { SettingsDialog } from './SettingsDialog'

/*
 * The per-row controls on Settings tables: the active toggle (the normal way
 * to retire a row) and delete (only for a row nothing points at; the server
 * refuses otherwise and the reason is shown inside the same dialog).
 */

const toggleClass = (active: boolean) =>
  cx(
    'inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold leading-none ring-1 ring-inset transition-colors',
    active ? 'bg-v2-ok-bg text-v2-ok ring-transparent hover:bg-v2-mint/50' : 'bg-v2-surface-2 text-v2-muted ring-v2-line hover:bg-v2-sunken',
    v2Focus,
  )

export function ActiveToggle({
  id,
  active,
  name,
  action,
}: {
  id: string
  active: boolean
  name: string
  action: (formData: FormData) => Promise<void>
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button type="submit" className={toggleClass(active)} aria-label={`${active ? 'Deactivate' : 'Activate'} ${name}`} title={active ? 'Click to deactivate' : 'Click to activate'}>
        {active ? 'Active' : 'Inactive'}
      </button>
    </form>
  )
}

/** Same toggle, but the action can refuse (last admin, your own account) and the refusal is shown beside it. */
export function GuardedActiveToggle({
  id,
  active,
  name,
  action,
}: {
  id: string
  active: boolean
  name: string
  action: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>
}) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button
        type="submit"
        disabled={pending}
        className={cx(toggleClass(active), pending && 'opacity-60')}
        aria-label={`${active ? 'Deactivate' : 'Activate'} ${name}`}
        title={active ? 'Click to deactivate' : 'Click to activate'}
      >
        {active ? 'Active' : 'Inactive'}
      </button>
      {state.error ? (
        <span role="alert" className="max-w-[26ch] whitespace-normal text-xs font-medium text-v2-bad">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}

export function DeleteButton({
  id,
  name,
  noun,
  action,
}: {
  id: string
  name: string
  /** "outlet" or "staff member", for the dialog copy. */
  noun: string
  action: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(action, {})
  const titleId = `delete-${id}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${name}`}
        title="Delete"
        className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-faint transition-colors hover:bg-v2-bad-bg hover:text-v2-bad', v2Focus)}
      >
        <Trash2 size={15} aria-hidden />
      </button>
      {open ? (
        <SettingsDialog kind="alert" width="sm" title={`Delete ${name}?`} titleId={titleId} onClose={() => setOpen(false)}>
          <p className="text-sm text-v2-muted">
            {state.error ? (
              <span role="alert" className="font-medium text-v2-bad">
                {state.error}
              </span>
            ) : (
              <>This removes the {noun} for good. It is only allowed when nothing else points at it; otherwise deactivate instead.</>
            )}
          </p>
          <form action={formAction} className="mt-4 flex gap-2">
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Keep
            </Button>
          </form>
        </SettingsDialog>
      ) : null}
    </>
  )
}
