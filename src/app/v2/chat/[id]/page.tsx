import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { findConversation } from '@/lib/repo/whatsappRepo'
import { ChatShell } from '@/components/v2/chat/ChatShell'
import { CHAT_BASE, ChatList, listQuery, readListParams } from '@/components/v2/chat/ChatList'
import { ChatThread } from '@/components/v2/chat/ChatThread'

export const metadata = { title: 'WhatsApp · RailServe' }

export default async function V2ChatThreadPage(props: PageProps<'/v2/chat/[id]'>) {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
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
      list={<ChatList ctx={ctx} params={sp} activeId={id} />}
      thread={<ChatThread ctx={ctx} conversation={conversation} backHref={q ? `${CHAT_BASE}?${q}` : CHAT_BASE} />}
    />
  )
}
