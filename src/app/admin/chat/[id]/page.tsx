import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { findConversation } from '@/lib/repo/whatsappRepo'
import { ChatShell, chatNote } from '@/components/chat/ChatShell'
import { ConversationList, listQuery, readListParams } from '@/components/chat/ConversationList'
import { Thread } from '@/components/chat/Thread'

export const metadata = { title: 'WhatsApp · RailServe' }

export default async function AdminChatThreadPage(props: PageProps<'/admin/chat/[id]'>) {
  const ctx = await requireRole('ADMIN')
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams])
  await connectDb()

  const conversation = await findConversation(ctx, id)
  if (!conversation) notFound()

  // The rail's search and filter, so the phone-width back arrow lands on the same list.
  const q = listQuery(readListParams(sp)).toString()
  return (
    <ChatShell
      threadOpen
      conversationId={id}
      note={chatNote()}
      list={<ConversationList ctx={ctx} params={sp} activeId={id} basePath="/admin/chat" />}
      thread={
        <Thread
          ctx={ctx}
          conversation={conversation}
          orderBasePath="/admin/orders"
          backHref={q ? `/admin/chat?${q}` : '/admin/chat'}
        />
      }
    />
  )
}
