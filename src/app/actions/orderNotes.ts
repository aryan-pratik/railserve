'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import {
  appendCallNote,
  deleteCallNote,
  editCallNote,
  listCallNotes,
  CALL_NOTE_MAX,
} from '@/lib/repo/orderRepo'
import type { CallNoteView } from '@/lib/callNotes'

export type CallNoteState = {
  error?: string
  ok?: string
  /**
   * Changes on every success. Two notes in a row both report "Note added.", so
   * a caller needs something that differs to know anything happened at all.
   */
  savedAt?: string
  /**
   * The whole log as it now stands.
   *
   * Returned rather than left to a refetch because the admin slide-over holds
   * its own fetched copy of the order: asking it to go and get the order again
   * races the revalidation this same action triggers, and loses often enough
   * that the note only appeared after closing and reopening the drawer. Handing
   * back the answer removes the race instead of tuning it.
   */
  notes?: CallNoteView[]
}

/** Every console that renders a call log or its badge. */
function revalidateAll(orderId: string) {
  revalidatePath(`/calls/orders/${orderId}`)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath(`/agent/orders/${orderId}`)
  revalidatePath('/calls')
  revalidatePath('/calls/live')
  revalidatePath('/store')
  revalidatePath('/admin')
}

/**
 * Adds one note to an order's call log, for both consoles that have one.
 *
 * A telecaller writes what the passenger said; an admin writes what they were
 * told second-hand. appendCallNote already refuses every other role and every
 * outlet the caller does not hold, so there is nothing role-specific left to
 * duplicate into two copies of this file.
 */
export async function addCallNoteAction(
  _prev: CallNoteState,
  formData: FormData,
): Promise<CallNoteState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const text = String(formData.get('text') ?? '').trim()

  if (text.length < 2) return { error: 'Write what the passenger said.' }
  if (text.length > CALL_NOTE_MAX) {
    return { error: `Keep a call note under ${CALL_NOTE_MAX} characters.` }
  }

  try {
    await appendCallNote(ctx, orderId, text)
    const notes = await listCallNotes(ctx, orderId)
    revalidateAll(orderId)
    return { ok: 'Note added.', savedAt: new Date().toISOString(), notes }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the note.' }
  }
}

/** Corrects a note. Its author or an admin only, enforced in the repository. */
export async function editCallNoteAction(
  _prev: CallNoteState,
  formData: FormData,
): Promise<CallNoteState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const noteId = String(formData.get('noteId') ?? '')
  const text = String(formData.get('text') ?? '').trim()

  if (text.length < 2) return { error: 'A note cannot be empty.' }
  if (text.length > CALL_NOTE_MAX) {
    return { error: `Keep a call note under ${CALL_NOTE_MAX} characters.` }
  }

  try {
    await editCallNote(ctx, orderId, noteId, text)
    const notes = await listCallNotes(ctx, orderId)
    revalidateAll(orderId)
    return { ok: 'Note updated.', savedAt: new Date().toISOString(), notes }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the note.' }
  }
}

/** Removes a note outright. Its author or an admin only. */
export async function deleteCallNoteAction(
  _prev: CallNoteState,
  formData: FormData,
): Promise<CallNoteState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const noteId = String(formData.get('noteId') ?? '')

  try {
    await deleteCallNote(ctx, orderId, noteId)
    const notes = await listCallNotes(ctx, orderId)
    revalidateAll(orderId)
    return { ok: 'Note deleted.', savedAt: new Date().toISOString(), notes }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete the note.' }
  }
}
