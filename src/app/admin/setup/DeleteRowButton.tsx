'use client'

import { useActionState, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button, focusRing } from '@/components/ui'
import { IconTrash } from '@/components/Icons'

type DeleteState = { error?: string }

/**
 * The delete control for one setup row.
 *
 * Confirms first, and when the server refuses (because orders, logs or staff
 * still point at the row) says why inside the same dialog instead of closing
 * on a failure the admin never sees. On success there is nothing to do here:
 * the page revalidates and this row, and this button, are gone.
 */
export function DeleteRowButton({
  id,
  name,
  noun,
  action,
}: {
  id: string
  name: string
  /** "outlet" or "staff member", for the dialog copy. */
  noun: string
  action: (prev: DeleteState, formData: FormData) => Promise<DeleteState>
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
        className={`rounded p-1.5 text-faint transition-colors hover:bg-red-50 hover:text-red-700 ${focusRing}`}
      >
        <IconTrash size={15} />
      </button>

      {open ? (
        <ConfirmDialog
          title={`Delete ${name}?`}
          titleId={titleId}
          onCancel={() => setOpen(false)}
          actions={
            <form action={formAction} className="flex gap-2">
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="danger" pending={pending}>
                Delete
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Keep
              </Button>
            </form>
          }
        >
          {state.error ? (
            <span role="alert" className="font-medium text-red-700">
              {state.error}
            </span>
          ) : (
            <>This removes the {noun} for good. It is only allowed when nothing else points at it; otherwise deactivate instead.</>
          )}
        </ConfirmDialog>
      ) : null}
    </>
  )
}
