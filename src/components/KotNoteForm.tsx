'use client'

import { useActionState, useId } from 'react'
import { Button, FormNote, textareaClass } from '@/components/ui'
import { setKotNoteAction, type KotNoteState } from '@/app/actions/orderNotes'

const initial: KotNoteState = {}

/**
 * The single note a telecaller (or an admin) attaches for the kitchen —
 * overwritable like the admin `remark`, not an append-only log like the call
 * log, but unlike `remark` it prints on the KOT. Shared between the calls and
 * admin consoles, the two roles setKotNote allows.
 */
export function KotNoteForm({ orderId, kotNote }: { orderId: string; kotNote: string | null }) {
  const [state, action, pending] = useActionState(setKotNoteAction, initial)
  const fieldId = useId()

  return (
    <form action={action} className="p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={fieldId} className="sr-only">KOT note</label>
      <div className="max-w-[68ch] space-y-2">
        <textarea
          id={fieldId}
          name="kotNote"
          defaultValue={kotNote ?? ''}
          maxLength={500}
          rows={3}
          placeholder="e.g. Call before leaving the platform"
          className={textareaClass}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            Save KOT note
          </Button>
          <FormNote state={state} />
        </div>
        <p className="text-xs text-muted">Prints on the KOT when the kitchen generates it.</p>
      </div>
    </form>
  )
}
