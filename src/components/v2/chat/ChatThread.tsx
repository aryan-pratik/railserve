import Link from 'next/link'
import { ArrowLeft, MessageCircle, Phone } from 'lucide-react'
import type { AuthContext } from '@/lib/authContext'
import type { WaConversationDoc } from '@/lib/models'
import { labelsFor, linkedOrder, listAssignableChatUsers, listMessagesPage } from '@/lib/repo/whatsappRepo'
import { openerTemplate } from '@/lib/whatsapp'
import { formatPhone } from '@/lib/whatsapp/phone'
import { sessionWindow } from '@/lib/whatsapp/session'
import { seatText } from '@/lib/format'
import { displayName, initialsOf, toMessageView } from '@/components/chat/chatView'
import { Chip, Mono, cx, statusChip, v2Focus } from '@/components/v2/ui'
import { ChatMessageList } from './ChatMessageList'
import { ChatComposer } from './ChatComposer'
import { ChatWindowPill } from './ChatWindowPill'
import { ChatThreadEffects } from './ChatThreadEffects'
import { ChatAssignSelect } from './ChatAssignSelect'
import { ChatTakeButton } from './ChatTakeButton'

/** What the right pane shows at /v2/chat, before a thread is picked. */
export function ChatThreadPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center bg-v2-bg p-8 text-center">
      <div className="max-w-xs">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-v2-brand-soft text-v2-brand">
          <MessageCircle size={22} aria-hidden />
        </span>
        <p className="text-sm font-bold">Pick a conversation</p>
        <p className="mt-1 text-xs leading-relaxed text-v2-muted">Replies land here as the passenger sends them. Open a thread from the list, or from the WhatsApp button on any order.</p>
      </div>
    </div>
  )
}

/**
 * One passenger's thread: who they are, which order this is about, whether
 * WhatsApp will let us write freely right now, and the messages. The order
 * and the seat sit in the header as a chip linking to the workspace.
 */
export async function ChatThread({ ctx, conversation: c, backHref }: { ctx: AuthContext; conversation: WaConversationDoc; backHref: string }) {
  const id = String(c._id)
  const isAdmin = ctx.role === 'ADMIN'
  const [{ rows: messages, hasMore: hasOlder }, order, assignable] = await Promise.all([
    listMessagesPage(ctx, id),
    linkedOrder(ctx, c),
    isAdmin ? listAssignableChatUsers(ctx) : Promise.resolve([]),
  ])
  const labels = await labelsFor([c], messages.map((m) => m.sentBy))
  const name = displayName(c)
  const me = String(ctx.userId)
  const assignee = c.assignedTo ? (String(c.assignedTo) === me ? 'You' : (labels.userName.get(String(c.assignedTo)) ?? 'Someone')) : null
  const outlet = c.restaurantId ? labels.outletName.get(String(c.restaurantId)) : null
  const window = sessionWindow(c.lastInboundAt)
  const views = messages.map((m) => toMessageView(m, (uid) => (uid === me ? 'You' : (labels.userName.get(uid) ?? null))))
  const orderStatus = order ? statusChip(order.status) : null

  return (
    <>
      <ChatThreadEffects conversationId={id} unread={c.unreadCount} />

      <header className="shrink-0 border-b border-v2-line bg-v2-surface px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2.5">
          <Link
            href={backHref}
            aria-label="Back to conversations"
            className={cx('-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink lg:hidden', v2Focus)}
          >
            <ArrowLeft size={18} aria-hidden />
          </Link>
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-v2-brand-soft text-xs font-bold text-v2-brand">
            {initialsOf(name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="truncate text-sm font-bold">{name}</h2>
              <ChatWindowPill lastInboundAt={c.lastInboundAt ? new Date(c.lastInboundAt).toISOString() : null} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-v2-muted">
              <a href={`tel:+${c.phone}`} className={cx('inline-flex items-center gap-1 rounded font-mono tabular-nums text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
                <Phone size={11} aria-hidden />
                {formatPhone(c.phone)}
              </a>
              {outlet ? <span className="truncate">{outlet}</span> : null}
            </div>
          </div>

          <div className="shrink-0">
            {isAdmin ? (
              <ChatAssignSelect conversationId={id} assignedTo={c.assignedTo ? String(c.assignedTo) : null} users={assignable} />
            ) : assignee && assignee !== 'You' ? (
              <span className="max-w-[7rem] truncate text-xs text-v2-muted" title={`${assignee} is answering this passenger`}>
                {assignee}
              </span>
            ) : (
              <ChatTakeButton conversationId={id} mine={assignee === 'You'} />
            )}
          </div>
        </div>

        {order && orderStatus ? (
          <Link
            href={`/v2/orders/${String(order._id)}`}
            className={cx('mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-v2-md bg-v2-surface-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-v2-brand-soft', v2Focus)}
          >
            <Mono className="font-semibold text-v2-brand">{order.externalOrderId}</Mono>
            {order.trainNo ? (
              <span className="text-v2-muted">
                <Mono className="font-semibold text-v2-ink">{order.trainNo}</Mono>
                {order.trainName ? ` ${order.trainName}` : ''}
              </span>
            ) : null}
            <span className="text-v2-muted">{order.handoverPoint ? `Handover: ${order.handoverPoint}` : seatText(order)}</span>
            <span className="ml-auto">
              <Chip tone={orderStatus.tone}>{orderStatus.label}</Chip>
            </span>
          </Link>
        ) : null}
      </header>

      <ChatMessageList key={id} messages={views} hasOlder={hasOlder} conversationId={id} />

      <ChatComposer conversationId={id} windowOpen={window.open} windowReason={window.open ? null : window.reason} openerAvailable={openerTemplate() !== null} />
    </>
  )
}
