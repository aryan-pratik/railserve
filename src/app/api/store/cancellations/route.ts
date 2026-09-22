import { requireRole } from '@/lib/session'
import { recentCancellations } from '@/lib/repo/orderRepo'
import { todayIST } from '@/lib/format'

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
 * How far back an alert stays on screen.
 *
 * Not a notification that fires once and is gone: a manager who stepped away
 * from the screen for twenty minutes is exactly the person this exists for.
 * Two hours covers a service window; anything older is either dealt with or
 * no longer actionable, and the banner is dismissible per order anyway.
 */
const WINDOW_MINUTES = 120

/**
 * The status-change alert feed behind CancellationAlert.
 *
 * Why this exists at all: cancelling, misdelivering, missing, refunding, or
 * flagging an order as a decoy all take it off LIVE_STATUSES, which means it
 * silently disappears from the kitchen board and the rider's runs. Nothing
 * about that disappearance says "stop cooking" — so when a telecaller changes
 * an order mid-service, the kitchen carries on and a rider picks up food
 * nobody is going to take delivery of. This says it out loud instead.
 *
 * Two modes on one route, deliberately:
 *   - default: SSE, the same shape as /api/store/stream and /api/payments/stream.
 *   - ?poll=1: one JSON snapshot, for the client's fallback when the stream is
 *     not delivering. A proxy that buffers SSE fails silently — the connection
 *     looks open and no frame ever arrives — and this is too important to have
 *     exactly one way of working.
 *
 * Scoped per subscriber like every other read here, so a manager is told about
 * their own outlets' cancellations and nobody else's.
 */
export async function GET(request: Request) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN', 'DELIVERY_AGENT')

  const read = () =>
    recentCancellations(ctx, {
      // Read inside the closure, not once at connect: a stream opened before
      // midnight IST must follow the service date over, not keep reporting
      // yesterday's.
      serviceDate: todayIST(),
      since: new Date(Date.now() - WINDOW_MINUTES * 60_000),
    })

  if (new URL(request.url).searchParams.get('poll') === '1') {
    return Response.json(
      { cancellations: await read(), at: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const encoder = new TextEncoder()
  let closed = false
  let cleanup: (() => void) | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // The identity of the set, not its contents: a cancellation's fields do
      // not change after the fact, so a new id is the only thing worth waking
      // the client for.
      const signature = (rows: Awaited<ReturnType<typeof read>>) => rows.map((r) => r.id).join(',')

      const rows = await read()
      let previous = signature(rows)
      send('snapshot', { cancellations: rows, at: new Date().toISOString() })

      const timer = setInterval(async () => {
        if (closed) return
        try {
          const next = await read()
          const sig = signature(next)
          if (sig !== previous) {
            previous = sig
            send('change', { cancellations: next, at: new Date().toISOString() })
          } else {
            // Keeps proxies from closing an idle connection — and doubles as
            // the client's proof that the stream is actually delivering.
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
