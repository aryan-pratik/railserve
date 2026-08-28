import { NextResponse } from 'next/server'
import { z } from 'zod'
import { contextFromBearer } from '@/lib/mobile/token'
import { findById } from '@/lib/repo/orderRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { dispatchRun } from '@/lib/repo/runRepo'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/authContext'
import { rupeesToPaise } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Batch mutation endpoint for the Expo app's offline queue.
 *
 * The app queues writes locally while it has no signal and flushes them here
 * when it reconnects, so every mutation must be safe to replay. Each item
 * carries a clientId; the response reports per-item outcomes rather than
 * failing the batch, because one dead item must not block the rest of a run
 * from syncing.
 *
 * "Already in the target state" is reported as `applied: true` with
 * `alreadyDone`. That distinction matters: a queue that treats a replayed
 * delivery as an error would retry it forever.
 */
const Mutation = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('DISPATCH_RUN'),
    clientId: z.string().min(1),
    runKey: z.string().min(1),
    at: z.string().optional(),
  }),
  z.object({
    kind: z.literal('DELIVER_ORDER'),
    clientId: z.string().min(1),
    orderId: z.string().min(1),
    // Either is enough. A photo is stronger, but a rider with a dead camera or
    // no signal must still be able to close an order at the door.
    receivedBy: z.string().trim().default(''),
    proofKey: z.string().trim().optional().nullable(),
    amountCollected: z.string().optional().nullable(),
    at: z.string().optional(),
  }).refine((v) => Boolean(v.proofKey) || v.receivedBy.length > 0, {
    message: 'A delivery needs either a photo or the name of who received it',
    path: ['receivedBy'],
  }),
  z.object({
    kind: z.literal('FAIL_ORDER'),
    clientId: z.string().min(1),
    orderId: z.string().min(1),
    failureReason: z.string().trim().min(1),
    at: z.string().optional(),
  }),
])

const Body = z.object({ mutations: z.array(Mutation).min(1).max(100) })

type ItemResult = {
  clientId: string
  applied: boolean
  alreadyDone?: boolean
  /** true when retrying could still succeed; false means drop it from the queue. */
  retryable?: boolean
  error?: string
}

export async function POST(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Malformed mutation batch.' }, { status: 400 })
  }

  const results: ItemResult[] = []

  for (const m of parsed.data.mutations) {
    try {
      if (m.kind === 'DISPATCH_RUN') {
        const r = await dispatchRun(ctx, m.runKey)
        if (r.moved === 0 && r.skipped > 0) {
          // Everything was already dispatched, or nothing was ready. Either
          // way a replay will not improve matters.
          results.push({ clientId: m.clientId, applied: true, alreadyDone: true })
        } else if (r.errors.length && r.moved === 0) {
          results.push({
            clientId: m.clientId, applied: false, retryable: false,
            error: r.errors.join('; '),
          })
        } else {
          results.push({ clientId: m.clientId, applied: true })
        }
        continue
      }

      const target = m.kind === 'DELIVER_ORDER' ? 'DELIVERED' : 'FAILED'
      const current = await findById(ctx, m.orderId)

      if (!current) {
        results.push({
          clientId: m.clientId, applied: false, retryable: false,
          error: 'Order not found or no longer assigned to you.',
        })
        continue
      }

      if (current.status === target) {
        results.push({ clientId: m.clientId, applied: true, alreadyDone: true })
        continue
      }

      await transitionOrder({
        ctx,
        orderId: m.orderId,
        to: target,
        meta: { via: 'expo-app', clientId: m.clientId, queuedAt: m.at ?? null },
        apply:
          m.kind === 'DELIVER_ORDER'
            ? {
                // The photo wins when both are present — it is the evidence
                // that survives a dispute. proofValue holds the object key,
                // never a presigned URL, which would be dead within the hour.
                ...(m.proofKey
                  ? { proofType: 'PHOTO' as const, proofValue: m.proofKey }
                  : { proofType: 'SIGNATURE' as const, proofValue: m.receivedBy }),
                ...(m.amountCollected
                  ? { amountCollectedPaise: rupeesToPaise(m.amountCollected) ?? undefined }
                  : {}),
              }
            : { failureReason: m.failureReason },
      })

      results.push({ clientId: m.clientId, applied: true })
    } catch (err) {
      // A conflict or a permission failure will never succeed on retry; a
      // transient database error might.
      const permanent =
        err instanceof ConflictError ||
        err instanceof ForbiddenError ||
        err instanceof NotFoundError
      results.push({
        clientId: m.clientId,
        applied: false,
        retryable: !permanent,
        error: err instanceof Error ? err.message : 'Mutation failed',
      })
    }
  }

  return NextResponse.json({ results, at: new Date().toISOString() })
}
