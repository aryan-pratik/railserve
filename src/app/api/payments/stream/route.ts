import { requireRole } from '@/lib/session'
import { paymentsSignature } from '@/lib/repo/paymentRepo'

export const dynamic = 'force-dynamic'

/**
 * Serverless kills a function at its duration cap, so an SSE stream cannot run
 * forever. Rather than be cut off mid-message, the stream closes itself just
 * inside the window and lets EventSource reconnect — that is exactly the
 * behaviour SSE was chosen for.
 */
export const maxDuration = 60
const STREAM_LIFETIME_MS = 50_000
const TICK_MS = 3_000

/**
 * Live feed for the payments page, following /api/store/stream's shape.
 *
 * Replaces a 30-second full-page refresh. The difference is not only speed:
 * the poll re-rendered the whole page and re-ran three queries every 30s
 * whether or not anything had happened, while this holds one connection and
 * says nothing until the collection actually changes. Faster and cheaper at
 * the same time.
 *
 * Unlike the store stream this needs no per-subscriber scoping — payments are
 * one shared bank account with nothing on an alert that says which outlet it
 * belongs to — so the fingerprint is global and identical for every viewer.
 */
export async function GET() {
  await requireRole('ADMIN', 'STORE_MANAGER')

  const encoder = new TextEncoder()
  let closed = false
  let cleanup: (() => void) | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      let previous = await paymentsSignature()
      send('snapshot', { at: new Date().toISOString() })

      const timer = setInterval(async () => {
        if (closed) return
        try {
          const next = await paymentsSignature()
          if (next !== previous) {
            send('change', { at: new Date().toISOString() })
            previous = next
          } else {
            // Keeps proxies from closing an idle connection.
            send('ping', { at: new Date().toISOString() })
          }
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
      // The client went away — stop the timer, or it keeps querying Mongo for
      // a reader that no longer exists.
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
