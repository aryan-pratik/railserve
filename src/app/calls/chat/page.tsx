import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { ChatShell, chatNote } from '@/components/chat/ChatShell'
import { ConversationList } from '@/components/chat/ConversationList'
import { ThreadPlaceholder } from '@/components/chat/Thread'

export const metadata = { title: 'WhatsApp · RailServe' }

/** The list alone (phone) or the list with an empty right pane (desktop). */
export default async function ChatPage(props: PageProps<'/calls/chat'>) {
  const ctx = await requireRole('TELECALLER')
  const sp = await props.searchParams
  await connectDb()
  return (
    <ChatShell
      threadOpen={false}
      note={chatNote()}
      list={<ConversationList ctx={ctx} params={sp} basePath="/calls/chat" />}
      thread={<ThreadPlaceholder />}
    />
  )
}
