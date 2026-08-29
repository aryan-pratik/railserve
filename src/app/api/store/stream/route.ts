import { requireAuth } from '@/lib/session'
import { countByStatus } from '@/lib/repo/orderRepo'
import { todayIST } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Serverless kills a function at its duration cap, so an SSE stream cannot run
 * forever. Rather than be cut off mid-message, the stream closes itself just
 * inside the window and lets EventSource reconnect — that is exactly the
 * behaviour SSE was chosen for. Raise this if the deployment allows longer.
 */
export const maxDuration = 60
const STREAM_LIFETIME_MS = 50_000
const TICK_MS = 5_000

/**
 * Server-Sent Events feed for the store dashboard. Plan §2 picks SSE over
 * WebSockets because it reconnects on its own and needs no extra protocol.
 *
 * This polls the scoped repository rather than tailing a change stream: the
 * scope must be applied per subscriber, and a change stream would hand this
 * connection every outlet's writes to filter in application code — exactly the
 * cross-tenant shape plan §2 is trying to eliminate.
 */
export async function GET() {
  const ctx = await requireAuth()

  const encoder = new TextEncoder()
  let closed = false
  let cleanup: (() => void) | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const snapshot = async () => {
        const counts = await countByStatus(ctx, { serviceDate: todayIST() })
        return {
          counts,
          total: Object.values(counts).reduce((a, b) => a + b, 0),
          at: new Date().toISOString(),
        }
      }

      let previous = await snapshot()
      send('snapshot', previous)

      const timer = setInterval(async () => {
        if (closed) return
        try {
          const next = await snapshot()
          // Only wake the client when something actually moved.
          if (JSON.stringify(next.counts) !== JSON.stringify(previous.counts)) {
            const newOrders = (next.counts.RECEIVED ?? 0) - (previous.counts.RECEIVED ?? 0)
            send('change', { ...next, newOrders })
          } else {
            // Keeps proxies from closing an idle connection.
            send('ping', { at: next.at })
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

      // Retire the connection before the platform does. The client reconnects
      // on its own, so a clean close is invisible; being killed mid-write is
      // not — it surfaces as an error event and a gap in the feed.
      const lifetime = setTimeout(close, STREAM_LIFETIME_MS)

      cleanup = close
    },
    cancel() {
      // The client went away — stop the timers, or the interval keeps polling
      // Mongo for a reader that no longer exists.
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
