'use client'

import { useActionState } from 'react'
import type { ChatActionState } from '@/app/actions/chat'
import { assignToV2 } from '@/app/v2/chat/actions'
import { FormLine } from '@/components/v2/CallsDialog'
import { Select } from '@/components/v2/Select'

const initial: ChatActionState = {}

export type AssignableUser = { id: string; name: string; role: string }

/** The admin's Take/Release: a name. Commits on change, like the inline edits elsewhere. */
export function ChatAssignSelect({ conversationId, assignedTo, users }: { conversationId: string; assignedTo: string | null; users: AssignableUser[] }) {
  const [state, action, pending] = useActionState(assignToV2, initial)
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Select
        id={`assign-${conversationId}`}
        name="userId"
        aria-label="Assigned to"
        // Keyed on the saved value so a revalidated page re-seeds the control.
        key={assignedTo ?? 'none'}
        defaultValue={assignedTo ?? ''}
        disabled={pending}
        submitOnChange
        size="sm"
        align="right"
        className="max-w-[11rem]"
        buttonClassName="text-xs font-semibold"
        options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: `${u.name}${u.role === 'ADMIN' ? ' (admin)' : ''}` }))]}
      />
      {state.error ? <FormLine state={{ error: state.error }} /> : null}
    </form>
  )
}
