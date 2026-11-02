import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { ChatShell, chatNote } from '@/components/chat/ChatShell'
import { ConversationList } from '@/components/chat/ConversationList'
import { ThreadPlaceholder } from '@/components/chat/Thread'

export const metadata = { title: 'WhatsApp · RailServe' }

/**
 * The same chat, on the admin console. The one difference is scope: an admin
 * sees every outlet's passengers, and can hand a thread to a named telecaller
 * from the thread header (see AssignSelect).
 */
export default async function AdminChatPage(props: PageProps<'/admin/chat'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  await connectDb()
  return (
    <ChatShell
      threadOpen={false}
      note={chatNote()}
      list={<ConversationList ctx={ctx} params={sp} basePath="/admin/chat" />}
      thread={<ThreadPlaceholder />}
    />
  )
}
