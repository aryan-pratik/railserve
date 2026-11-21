'use client'

import { useActionState, useEffect, useId } from 'react'
import type { CallNoteState } from '@/app/actions/orderNotes'
import { addCallNoteV2 } from '@/app/v2/calls/actions'
import { FormLine, v2Input } from './CallsDialog'
import { Button } from './ui'

const initial: CallNoteState = {}

/**
 * One note on an order's call log, inline under the row. Uncontrolled; the
 * box is keyed on the action's token so a saved note leaves an empty box.
 */
export function CallsNoteForm({ orderId, onSaved }: { orderId: string; onSaved?: () => void }) {
  const [state, action, pending] = useActionState(addCallNoteV2, initial)
  const fieldId = useId()

  useEffect(() => {
    if (state.savedAt) onSaved?.()
    // onSaved is a fresh closure each render; depending on it would re-fire on renders where nothing was saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt])

  return (
    <form action={action} className="grid max-w-[68ch] gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={fieldId} className="sr-only">
        Add a call note
      </label>
      <textarea
        key={state.savedAt ?? 'new'}
        id={fieldId}
        name="text"
        rows={2}
        maxLength={500}
        autoFocus
        placeholder="What did the passenger say?"
        className={v2Input}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Add note'}
        </Button>
        <FormLine state={state} />
      </div>
    </form>
  )
}
