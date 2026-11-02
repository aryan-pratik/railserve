import { requireAuth } from '@/lib/session'
import { chatVersion } from '@/lib/repo/whatsappRepo'

export const dynamic = 'force-dynamic'

/** Same shape and reasoning as /api/store/stream: a polling SSE feed per subscriber. */
export const maxDuration = 60
const STREAM_LIFETIME_MS = 50_000
const TICK_MS = 3_000

/**
 * Live feed for the WhatsApp screen. Says "list" when any thread in scope
 * changed and "thread" when the one being read did, so the client refreshes
 * the server-rendered page only when there is something new to draw.
 *
 * Polls the scoped repository rather than tailing a change stream, for the
 * reason the store feed gives: the scope has to be applied per subscriber.
 */
export async function GET(request: Request) {
  const ctx = await requireAuth()
  if (ctx.role !== 'TELECALLER' && ctx.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 })
  }
  const conversationId = new URL(request.url).searchParams.get('c')

  const encoder = new TextEncoder()
  let closed = false
  let cleanup: (() => void) | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      let previous = await chatVersion(ctx, conversationId)
      send('snapshot', previous)

      const timer = setInterval(async () => {
        if (closed) return
        try {
          const next = await chatVersion(ctx, conversationId)
          if (next.listAt !== previous.listAt || next.threadAt !== previous.threadAt) {
            send('change', { ...next, thread: next.threadAt !== previous.threadAt })
          } else {
            send('ping', { at: new Date().toISOString() })
          }
          previous = next
        } catch {
          // A transient DB hiccup must not kill the stream; the next tick retries.
        }
      }, TICK_MS)

      const close = () => {
        if (closed) return
        closed = true
        clearInterval(timer)
        clearTimeout(lifetime)
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
      }
      const lifetime = setTimeout(close, STREAM_LIFETIME_MS)
      cleanup = close
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
