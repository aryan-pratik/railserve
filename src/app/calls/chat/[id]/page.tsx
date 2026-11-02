import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { findConversation } from '@/lib/repo/whatsappRepo'
import { ChatShell, chatNote } from '@/components/chat/ChatShell'
import { ConversationList, listQuery, readListParams } from '@/components/chat/ConversationList'
import { Thread } from '@/components/chat/Thread'

export const metadata = { title: 'WhatsApp · RailServe' }

export default async function ChatThreadPage(props: PageProps<'/calls/chat/[id]'>) {
  const ctx = await requireRole('TELECALLER')
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams])
  await connectDb()

  // Scoped: another outlet's passenger is a miss, not a refusal.
  const conversation = await findConversation(ctx, id)
  if (!conversation) notFound()

  // The rail's search and filter, so the phone-width back arrow lands on the same list.
  const q = listQuery(readListParams(sp)).toString()
  return (
    <ChatShell
      threadOpen
      conversationId={id}
      note={chatNote()}
      list={<ConversationList ctx={ctx} params={sp} activeId={id} basePath="/calls/chat" />}
      thread={
        <Thread
          ctx={ctx}
          conversation={conversation}
          orderBasePath="/calls/orders"
          backHref={q ? `/calls/chat?${q}` : '/calls/chat'}
        />
      }
    />
  )
}
