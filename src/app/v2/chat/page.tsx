import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { ChatShell } from '@/components/v2/chat/ChatShell'
import { ChatList } from '@/components/v2/chat/ChatList'
import { ChatThreadPlaceholder } from '@/components/v2/chat/ChatThread'

export const metadata = { title: 'WhatsApp · RailServe' }

/**
 * The list alone (phone) or the list with an empty right pane (desktop).
 * One screen for both roles: scope comes from the repository (a telecaller
 * sees their outlets' threads plus unclaimed ones, an admin sees every one).
 */
export default async function V2ChatPage(props: PageProps<'/v2/chat'>) {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const sp = await props.searchParams
  await connectDb()
  return <ChatShell threadOpen={false} list={<ChatList ctx={ctx} params={sp} />} thread={<ChatThreadPlaceholder />} />
}
