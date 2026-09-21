'use client'

import { useActionState, useEffect, useState } from 'react'
import { formatIST } from '@/lib/format'
import type { CallNoteView } from '@/lib/callNotes'
import {
  deleteCallNoteAction,
  editCallNoteAction,
  type CallNoteState,
} from '@/app/actions/orderNotes'
import { IconCheck, IconClose, IconPencil, IconTrash } from './Icons'
import { IconButton, editInputClass, focusRingInset } from './ui'

const initial: CallNoteState = {}

/** Roughly six rows before it scrolls, on every screen that renders one. */
const MAX_HEIGHT = 'max-h-56'

/**
 * What was said on the phone. One note per line, newest first, scrolling.
 *
 * One line rather than two because this is a log: it is scanned far more often
 * than it is read, and a card that grows two lines per call pushes everything
 * under it off the screen by the afternoon. The text takes the room that is
 * going spare and truncates, with the whole note on hover, the same bargain
 * the remark column and the board's note badge already make.
 *
 * Newest first, which is the opposite of EventLog below it. That is deliberate
 * and follows from the cap: with a fixed height and oldest first, the note that
 * just came off a call, the only one that changes what anybody does next, is
 * the one hidden below the fold.
 */
export function CallLog({
  orderId,
  notes,
  onChanged,
}: {
  orderId: string
  notes: CallNoteView[]
  /**
   * Handed the log as it now stands after an edit or a delete. Server pages
   * pick the change up from revalidatePath and can ignore this; the admin
   * slide-over holds its own copy and cannot.
   */
  onChanged?: (notes: CallNoteView[]) => void
}) {
  if (notes.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">No call notes yet.</p>
  }

  return (
    <ol
      className={`${MAX_HEIGHT} divide-y divide-line overflow-y-auto [overscroll-behavior:contain]`}
    >
      {[...notes].reverse().map((n) => (
        <CallNoteRow key={n.id} orderId={orderId} note={n} onChanged={onChanged} />
      ))}
    </ol>
  )
}

function CallNoteRow({
  orderId,
  note,
  onChanged,
}: {
  orderId: string
  note: CallNoteView
  onChanged?: (notes: CallNoteView[]) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <li className="px-4 py-2">
        <EditNoteForm
          orderId={orderId}
          note={note}
          onChanged={onChanged}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="group flex items-baseline gap-3 px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-ink" title={note.text}>
        {note.text}
      </span>

      <span className="shrink-0 text-xs text-faint">
        <span className="tabular-nums">{formatIST(note.at)}</span>
        {note.author ? ` · ${note.author}` : ''}
        {note.editedAt ? <span className="ml-1 italic">edited</span> : null}
      </span>

      {note.canManage ? (
        // Always reachable on a touch screen, quiet until hovered on a desktop
        // where a row of controls beside every line is just noise.
        <span className="flex shrink-0 items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit the note "${note.text}"`}
            title="Edit"
            className={`rounded p-1 text-faint transition-colors hover:bg-sunken hover:text-ink ${focusRingInset}`}
          >
            <IconPencil size={13} />
          </button>
          <DeleteNoteButton orderId={orderId} note={note} onChanged={onChanged} />
        </span>
      ) : null}
    </li>
  )
}

function EditNoteForm({
  orderId,
  note,
  onChanged,
  onDone,
}: {
  orderId: string
  note: CallNoteView
  onChanged?: (notes: CallNoteView[]) => void
  onDone: () => void
}) {
  const [state, action, pending] = useActionState(editCallNoteAction, initial)

  useEffect(() => {
    if (!state.savedAt) return
    if (state.notes) onChanged?.(state.notes)
    onDone()
    // Firing on the action's own token, not on the callbacks, which are fresh
    // closures on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt])

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="noteId" value={note.id} />
      <input
        name="text"
        defaultValue={note.text}
        autoFocus
        maxLength={500}
        aria-label="Note"
        className={`min-w-0 flex-1 ${editInputClass}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
        }}
      />
      <IconButton type="submit" size="sm" aria-label="Save note" disabled={pending}>
        <IconCheck size={14} />
      </IconButton>
      <IconButton type="button" size="sm" aria-label="Cancel" onClick={onDone}>
        <IconClose size={14} />
      </IconButton>
      {state.error ? (
        <span role="alert" className="text-[11px] font-medium text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}

function DeleteNoteButton({
  orderId,
  note,
  onChanged,
}: {
  orderId: string
  note: CallNoteView
  onChanged?: (notes: CallNoteView[]) => void
}) {
  const [state, action, pending] = useActionState(deleteCallNoteAction, initial)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (state.savedAt && state.notes) onChanged?.(state.notes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt])

  // Confirm in place rather than in a dialog. One line of a working log is not
  // worth interrupting the screen for, but it is worth a second tap: the
  // delete is real and there is nothing to undo it with.
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete the note "${note.text}"`}
        title="Delete"
        className={`rounded p-1 text-faint transition-colors hover:bg-red-50 hover:text-red-700 ${focusRingInset}`}
      >
        <IconTrash size={13} />
      </button>
    )
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="noteId" value={note.id} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 ${focusRingInset}`}
      >
        Delete
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium text-muted transition-colors hover:bg-sunken ${focusRingInset}`}
      >
        Keep
      </button>
    </form>
  )
}
