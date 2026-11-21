'use client'

import { useEffect } from 'react'
import { markReadV2 } from '@/app/v2/chat/actions'

/** Opening a thread reads it: from the client after paint, so a prefetch cannot mark it read. */
export function ChatThreadEffects({ conversationId, unread }: { conversationId: string; unread: number }) {
  useEffect(() => {
    if (unread > 0) void markReadV2(conversationId)
  }, [conversationId, unread])
  return null
}
