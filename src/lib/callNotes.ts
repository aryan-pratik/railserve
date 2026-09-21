/**
 * The shape a call note takes once it has left the database.
 *
 * Its own module because both sides need it: server actions build it, and a
 * client component renders it. Types only, so importing this from the browser
 * drags no mongoose along.
 *
 * Everything is already a string. A Date crossing the server/client boundary
 * is the silent-corruption case React warns about, and these notes reach the
 * admin slide-over through exactly that boundary.
 */
export type CallNoteView = {
  id: string
  text: string
  /** Resolved author, with their role. Null where a page resolves no users. */
  author: string | null
  /** ISO. */
  at: string
  /** ISO, when the note has been corrected since it was written. */
  editedAt: string | null
  /** Whether the viewer may edit or delete this one. */
  canManage: boolean
}
