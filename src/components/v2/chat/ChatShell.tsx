import type { ReactNode } from 'react'
import { isWhatsAppSimulated } from '@/lib/whatsapp'
import { PageHeader } from '@/components/v2/Table'
import { cx } from '@/components/v2/ui'
import { ChatLive } from './ChatLive'

/** The line under the title: says plainly when nothing is reaching a real phone. */
export function chatNote() {
  return isWhatsAppSimulated()
    ? 'Simulated: nothing reaches a real phone. A pretend passenger answers every message.'
    : 'Replies from passengers on the business WhatsApp number, as they arrive.'
}

/**
 * The two-pane chat inside the v2 card language: a rail of conversations and
 * the thread being read, in one bordered block sized to the viewport so the
 * message list scrolls inside it and the composer stays at the bottom.
 * A phone shows one pane at a time, decided by which page rendered the
 * shell, so the URL is the whole truth and a reload lands where you were.
 */
export function ChatShell({
  list,
  thread,
  threadOpen,
  conversationId,
}: {
  list: ReactNode
  thread: ReactNode
  /** True on a thread page: on a phone the list hides behind it. */
  threadOpen: boolean
  conversationId?: string
}) {
  return (
    <div className="grid gap-[18px]">
      <PageHeader title="WhatsApp" note={<span className="hidden sm:inline">{chatNote()}</span>} actions={<ChatLive conversationId={conversationId} />} />
      <div
        className={cx(
          // minmax(0, 1fr) everywhere: a grid column defaults to min-content
          // width, which on a phone let a long header push the pane past the
          // viewport and clip the right edge.
          'grid min-h-[26rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface',
          'h-[calc(100dvh-13.5rem)] sm:h-[calc(100dvh-15rem)] lg:h-[calc(100dvh-15.5rem)] lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)]',
        )}
      >
        <aside aria-label="Conversations" className={cx('min-h-0 min-w-0 flex-col border-v2-line lg:flex lg:border-r', threadOpen ? 'hidden' : 'flex')}>
          {list}
        </aside>
        <section aria-label="Conversation" className={cx('min-h-0 min-w-0 flex-col lg:flex', threadOpen ? 'flex' : 'hidden')}>
          {thread}
        </section>
      </div>
    </div>
  )
}
