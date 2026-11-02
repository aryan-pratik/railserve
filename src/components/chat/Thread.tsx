import Link from 'next/link'
import type { AuthContext } from '@/lib/authContext'
import type { WaConversationDoc } from '@/lib/models'
import { labelsFor, linkedOrder, listAssignableChatUsers, listMessagesPage } from '@/lib/repo/whatsappRepo'
import { openerTemplate } from '@/lib/whatsapp'
import { formatPhone } from '@/lib/whatsapp/phone'
import { sessionWindow } from '@/lib/whatsapp/session'
import { seatText } from '@/lib/format'
import { IconArrowLeft, IconChat, IconPhone } from '@/components/Icons'
import { StatusBadge, focusRing } from '@/components/ui'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { WindowPill } from './WindowPill'
import { ThreadEffects } from './ThreadEffects'
import { AssignSelect } from './AssignSelect'
import { TakeButton } from './TakeButton'
import { displayName, initialsOf, toMessageView } from './chatView'

/** What the right pane shows at /calls/chat, before a thread is picked. */
export function ThreadPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-xs">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <IconChat size={22} aria-hidden />
        </span>
        <p className="text-sm font-medium text-ink text-balance">Pick a conversation</p>
        <p className="mt-1 text-xs leading-relaxed text-muted text-pretty">
          Replies land here as the passenger sends them. Open a thread from the list, or from the WhatsApp button on any order.
        </p>
      </div>
    </div>
  )
}

/**
 * One passenger's thread: who they are, which order this is about, whether
 * WhatsApp will let us write freely right now, and the messages.
 *
 * The header carries the two facts a chat about a train meal always comes
 * back to — the order and the seat — as a chip linking to the order page, so
 * the telecaller never has to search for it with the passenger waiting.
 */
export async function Thread({
  ctx,
  conversation: c,
  backHref,
  orderBasePath,
}: {
  ctx: AuthContext
  conversation: WaConversationDoc
  /** The list, with its filters, for the phone-width back arrow. */
  backHref: string
  /** Where this console's order pages live: '/calls/orders' or '/admin/orders'. */
  orderBasePath: string
}) {
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

  return (
    <>
      <ThreadEffects conversationId={id} unread={c.unreadCount} />

      <header className="shrink-0 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2.5">
          <Link
            href={backHref}
            aria-label="Back to conversations"
            className={`-ml-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink lg:hidden ${focusRing}`}
          >
            <IconArrowLeft size={18} aria-hidden />
          </Link>
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {initialsOf(name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="truncate text-sm font-semibold text-ink">{name}</h2>
              <WindowPill lastInboundAt={c.lastInboundAt ? new Date(c.lastInboundAt).toISOString() : null} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <a href={`tel:+${c.phone}`} className={`inline-flex items-center gap-1 rounded font-mono tabular-nums text-accent underline-offset-2 hover:underline ${focusRing}`}>
                <IconPhone size={11} aria-hidden />
                {formatPhone(c.phone)}
              </a>
              {outlet ? <span className="truncate">{outlet}</span> : null}
            </div>
          </div>

          {isAdmin ? (
            // The manager picks a name; a telecaller only takes or lets go.
            <div className="shrink-0">
              <AssignSelect conversationId={id} assignedTo={c.assignedTo ? String(c.assignedTo) : null} users={assignable} />
            </div>
          ) : (
            <div className="shrink-0">
              {assignee && assignee !== 'You' ? (
                <span className="hidden text-xs text-muted sm:inline" title="Who is answering this passenger">
                  {assignee}
                </span>
              ) : (
                <TakeButton conversationId={id} mine={assignee === 'You'} />
              )}
            </div>
          )}
        </div>

        {order ? (
          <Link
            href={`${orderBasePath}/${String(order._id)}`}
            className={`mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg bg-sunken/60 px-2.5 py-1.5 text-xs transition-colors hover:bg-sunken ${focusRing}`}
          >
            <span className="font-mono font-semibold text-accent">{order.externalOrderId}</span>
            {order.trainNo ? (
              <span className="text-muted">
                <span className="font-mono font-semibold tabular-nums text-ink">{order.trainNo}</span>
                {order.trainName ? ` ${order.trainName}` : ''}
              </span>
            ) : null}
            <span className="text-muted">{order.handoverPoint ? `Handover: ${order.handoverPoint}` : seatText(order)}</span>
            <span className="ml-auto">
              <StatusBadge status={order.status} />
            </span>
          </Link>
        ) : null}
      </header>

      <MessageList key={id} messages={views} hasOlder={hasOlder} conversationId={id} />

      <Composer
        conversationId={id}
        windowOpen={window.open}
        windowReason={window.open ? null : window.reason}
        openerAvailable={openerTemplate() !== null}
      />
    </>
  )
}
