import { requirePage, requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { ChatShell } from '@/components/v2/chat/ChatShell'
import { ChatList } from '@/components/v2/chat/ChatList'
import { ChatThreadPlaceholder } from '@/components/v2/chat/ChatThread'
import { isWhatsAppSimulatedFor } from '@/lib/whatsapp'

export const metadata = { title: 'WhatsApp · RailServe' }

/**
 * The list alone (phone) or the list with an empty right pane (desktop).
 * One screen for both roles: scope comes from the repository (a telecaller
 * sees their outlets' threads plus unclaimed ones, an admin sees every one).
 */
export default async function V2ChatPage(props: PageProps<'/v2/chat'>) {
  const ctx = await requirePermission('chat.use')
  await requirePage('chat')
  const sp = await props.searchParams
  await connectDb()
  return <ChatShell simulated={await isWhatsAppSimulatedFor(ctx.tenantId)} threadOpen={false} list={<ChatList ctx={ctx} params={sp} />} thread={<ChatThreadPlaceholder />} />
}
