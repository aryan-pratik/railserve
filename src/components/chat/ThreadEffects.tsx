'use client'

import { useEffect } from 'react'
import { markReadAction } from '@/app/actions/chat'

/**
 * Opening a thread reads it. Done from the client after paint rather than
 * during the server render, because a GET that writes to the database is the
 * kind of side effect that bites later (a prefetch would mark it read).
 */
export function ThreadEffects({ conversationId, unread }: { conversationId: string; unread: number }) {
  useEffect(() => {
    if (unread > 0) void markReadAction(conversationId)
  }, [conversationId, unread])
  return null
}
