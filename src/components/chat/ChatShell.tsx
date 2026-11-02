import type { ReactNode } from 'react'
import { PageHeader } from '@/components/ui'
import { isWhatsAppSimulated } from '@/lib/whatsapp'
import { ChatLive } from './ChatLive'

/** The line under the title: says plainly when nothing is reaching a real phone. */
export function chatNote() {
  return isWhatsAppSimulated()
    ? 'Simulated: nothing reaches a real phone. A pretend passenger answers every message.'
    : 'Replies from passengers on the business WhatsApp number, as they arrive.'
}

/**
 * The two-pane chat: a rail of conversations and the thread being read.
 *
 * Desktop shows both; the rail takes 17 to 21rem so the thread, which is the
 * thing the telecaller is actually working on, takes every pixel after it,
 * and still has room on a 1024px laptop beside the open sidebar.
 * A phone shows one pane at a time — the list at /calls/chat, the thread at
 * /calls/chat/[id] with a back arrow — decided here by which page rendered
 * the shell rather than by any client state, so the URL is the whole truth
 * and a reload lands where you were.
 *
 * The panel is sized to the viewport instead of growing with content: the
 * message list scrolls inside it and the composer stays at the bottom, the
 * way every messaging app works. The arithmetic subtracts the shell's own
 * header and padding at each breakpoint.
 */
export function ChatShell({
  list,
  thread,
  threadOpen,
  conversationId,
  note,
}: {
  list: ReactNode
  thread: ReactNode
  /** True on a thread page: on a phone the list hides behind it. */
  threadOpen: boolean
  conversationId?: string
  note: ReactNode
}) {
  return (
    <div className="space-y-4">
      {/* The note is hidden at phone width: with it the header ran to four
          lines and pushed the panel's own footer off the screen. The title
          and the live dot share one line there instead. */}
      <PageHeader
        title="WhatsApp"
        note={<span className="hidden sm:inline">{note}</span>}
        action={<ChatLive conversationId={conversationId} />}
      />

      <div
        className={
          'grid h-[calc(100dvh-10.5rem)] min-h-[26rem] overflow-hidden rounded-xl border border-line bg-surface shadow-sm ' +
          'sm:h-[calc(100dvh-12rem)] lg:h-[calc(100dvh-8.5rem)] lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)]'
        }
      >
        <aside
          aria-label="Conversations"
          className={`min-h-0 flex-col border-line lg:flex lg:border-r ${threadOpen ? 'hidden' : 'flex'}`}
        >
          {list}
        </aside>
        <section aria-label="Conversation" className={`min-h-0 flex-col lg:flex ${threadOpen ? 'flex' : 'hidden'}`}>
          {thread}
        </section>
      </div>
    </div>
  )
}
