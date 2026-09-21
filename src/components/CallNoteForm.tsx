'use client'

import { useActionState, useEffect, useId } from 'react'
import { Button, FormNote, textareaClass } from '@/components/ui'
import { addCallNoteAction, type CallNoteState } from '@/app/actions/orderNotes'
import type { CallNoteView } from '@/lib/callNotes'

const initial: CallNoteState = {}

/**
 * Adds one note to an order's call log.
 *
 * Rendered only on the two consoles whose role may write — but the gates that
 * matter are requireRole in the action and the role check in appendCallNote.
 * Leaving this off a page only means nobody clicks something they would be
 * refused anyway.
 *
 * Uncontrolled, like every other form here. The box is read once, on submit, by
 * name; holding its value in React state would re-render this component on
 * every keystroke for no gain — which is exactly what exposed the focus bug in
 * Modal.
 */
export function CallNoteForm({
  orderId,
  onSaved,
}: {
  orderId: string
  /**
   * Handed the log as it now stands. Server components pick the new note up
   * from revalidatePath on their own; this exists for the slide-over, which
   * holds its own fetched copy of the order and has nothing to revalidate.
   */
  onSaved?: (notes: CallNoteView[]) => void
}) {
  const [state, action, pending] = useActionState(addCallNoteAction, initial)
  // Several of these can be open at once on the call board, so a fixed id
  // would point every label at the first box.
  const fieldId = useId()

  useEffect(() => {
    if (state.savedAt && state.notes) onSaved?.(state.notes)
    // onSaved is a fresh closure on every render of the host; depending on it
    // would re-fire this on renders where nothing was saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt])

  return (
    <form action={action} className="p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={fieldId} className="sr-only">
        Add a call note
      </label>
      {/* Capped to the same measure as the notes above, so the box you type
          into shares their left edge and their width instead of running the
          full span of an admin column. */}
      <div className="max-w-[68ch] space-y-2">
        {/* Keyed on the action's own token so a saved note leaves an empty box
            behind: remounting says it in the render, where deriving belongs,
            rather than reaching for an effect after the fact. */}
        <textarea
          key={state.savedAt ?? 'new'}
          id={fieldId}
          name="text"
          rows={2}
          maxLength={500}
          placeholder="What did the passenger say?"
          className={textareaClass}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" pending={pending}>
            Add note
          </Button>
          <FormNote state={state} />
        </div>
      </div>
    </form>
  )
}
