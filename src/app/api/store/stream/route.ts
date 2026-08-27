import { requireAuth } from '@/lib/session'
import { countByStatus } from '@/lib/repo/orderRepo'
import { todayIST } from '@/lib/format'

export const dynamic = 'force-dynamic'

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
      }, 5000)

      const close = () => {
        closed = true
        clearInterval(timer)
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
      }
      ;(controller as unknown as { _close?: () => void })._close = close
    },
    cancel() {
      closed = true
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
