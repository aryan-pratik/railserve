'use client'

import { useActionState } from 'react'
import { Button, FormNote } from '@/components/ui'
import { releaseConversationAction, takeConversationAction, type ChatActionState } from '@/app/actions/chat'

const initial: ChatActionState = {}

/** Take an unheld thread, or let go of your own. A refusal reads back inline. */
export function TakeButton({ conversationId, mine }: { conversationId: string; mine: boolean }) {
  const [state, action, pending] = useActionState(mine ? releaseConversationAction : takeConversationAction, initial)
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Button
        type="submit"
        variant={mine ? 'ghost' : 'secondary'}
        size="sm"
        pending={pending}
        title={mine ? 'Stop answering this passenger' : 'Mark yourself as the one answering'}
      >
        {mine ? 'Release' : 'Take'}
      </Button>
      {state.error ? <FormNote state={{ error: state.error }} className="text-xs" /> : null}
    </form>
  )
}
