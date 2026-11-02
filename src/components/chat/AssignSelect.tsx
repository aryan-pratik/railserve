'use client'

import { useActionState, useRef } from 'react'
import { FormNote } from '@/components/ui'
import { assignToAction, type ChatActionState } from '@/app/actions/chat'

const initial: ChatActionState = {}

export type AssignableUser = { id: string; name: string; role: string }

/**
 * The admin's version of Take/Release: a name. A manager watching the desk
 * hands a waiting passenger to whoever is free, or takes a thread off
 * someone who has gone home, without the telecaller having to notice. Commits
 * on change — the inline-edit idiom the orders board already uses — because
 * a second "Save" control beside a select is just one more thing to miss.
 */
export function AssignSelect({
  conversationId,
  assignedTo,
  users,
}: {
  conversationId: string
  assignedTo: string | null
  users: AssignableUser[]
}) {
  const [state, action, pending] = useActionState(assignToAction, initial)
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form ref={formRef} action={action} className="flex items-center gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor={`assign-${conversationId}`} className="sr-only">
        Assigned to
      </label>
      <select
        id={`assign-${conversationId}`}
        name="userId"
        // Keyed on the saved value so a revalidated page re-seeds the control
        // without this component holding the value in state.
        key={assignedTo ?? 'none'}
        defaultValue={assignedTo ?? ''}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        title="Who is answering this passenger"
        className="h-8 max-w-[11rem] rounded-lg border border-line-strong bg-surface px-2 text-xs font-medium text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent disabled:opacity-60"
      >
        <option value="">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.role === 'ADMIN' ? ' (admin)' : ''}
          </option>
        ))}
      </select>
      {state.error ? <FormNote state={{ error: state.error }} className="text-xs" /> : null}
    </form>
  )
}
