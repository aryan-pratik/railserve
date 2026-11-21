'use client'

import { useActionState } from 'react'
import type { ChatActionState } from '@/app/actions/chat'
import { releaseConversationV2, takeConversationV2 } from '@/app/v2/chat/actions'
import { FormLine } from '@/components/v2/CallsDialog'
import { Button } from '@/components/v2/ui'

const initial: ChatActionState = {}

/** Take an unheld thread, or let go of your own. A refusal reads back inline. */
export function ChatTakeButton({ conversationId, mine }: { conversationId: string; mine: boolean }) {
  const [state, action, pending] = useActionState(mine ? releaseConversationV2 : takeConversationV2, initial)
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Button type="submit" variant={mine ? 'ghost' : 'soft'} size="sm" disabled={pending} title={mine ? 'Stop answering this passenger' : 'Mark yourself as the one answering'}>
        {mine ? 'Release' : 'Take'}
      </Button>
      {state.error ? <FormLine state={{ error: state.error }} /> : null}
    </form>
  )
}
