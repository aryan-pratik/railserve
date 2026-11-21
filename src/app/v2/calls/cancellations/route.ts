import { requirePermission } from '@/lib/session'
import { recentCancellations } from '@/lib/repo/orderRepo'
import { todayIST } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STREAM_LIFETIME_MS = 50_000
const TICK_MS = 3_000
const WINDOW_MINUTES = 120

/**
 * The cancellation feed for the call board: the same shape and the same two
 * modes (SSE, or `?poll=1` for one JSON snapshot) as /api/store/cancellations.
 * That route is gated to the kitchen and rider roles and redirects a
 * telecaller, so the call desk reads the identical repository query here.
 * Scoped per subscriber, like every other read.
 */
export async function GET(request: Request) {
  const ctx = await requirePermission('calls.operate')

  const read = () =>
    recentCancellations(ctx, {
      serviceDate: todayIST(),
      since: new Date(Date.now() - WINDOW_MINUTES * 60_000),
    })

  if (new URL(request.url).searchParams.get('poll') === '1') {
    return Response.json({ cancellations: await read(), at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
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
      // Retire the connection before the platform does; EventSource reconnects.
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
