import { NextResponse } from 'next/server'
import { z } from 'zod'
import { contextFromBearer } from '@/lib/mobile/token'
import { findById } from '@/lib/repo/orderRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { dispatchRun } from '@/lib/repo/runRepo'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/authContext'
import { rupeesToPaise } from '@/lib/format'

import { preflight, withCors } from '@/lib/mobile/cors'

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
    // One order, not a whole train. A rider picks which of a train's orders
    // they can physically carry — see the DISPATCH_RUN note below.
    kind: z.literal('DISPATCH_ORDER'),
    clientId: z.string().min(1),
    orderId: z.string().min(1),
    at: z.string().optional(),
  }),
  z.object({
    // Undo a mistapped pickup: the food goes back to the counter for someone
    // else. Audited like any other status change.
    kind: z.literal('RETURN_ORDER'),
    clientId: z.string().min(1),
    orderId: z.string().min(1),
    at: z.string().optional(),
  }),
  z.object({
    kind: z.literal('DELIVER_ORDER'),
    clientId: z.string().min(1),
    orderId: z.string().min(1),
    // The passenger's name is the proof the app collects today; proofKey is
    // kept for the photo path, which the server supports and the app does not
    // yet use. Neither is required, and deliberately so: a rider with no
    // signal on the platform still has to be able to close the job, so
    // refusing would strand a completed delivery in the queue forever.
    receivedBy: z.string().trim().default(''),
    proofKey: z.string().trim().optional().nullable(),
    amountCollected: z.string().optional().nullable(),
    at: z.string().optional(),
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
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return withCors(request, NextResponse.json({ error: 'Malformed mutation batch.' }, { status: 400 }))
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

      const target =
        m.kind === 'DELIVER_ORDER'
          ? 'DELIVERED'
          : m.kind === 'DISPATCH_ORDER'
            ? 'DISPATCHED'
            : m.kind === 'RETURN_ORDER'
              ? 'PREPARED'
              : 'FAILED'
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
          m.kind === 'DISPATCH_ORDER' || m.kind === 'RETURN_ORDER'
            ? // transitionOrder records or releases the rider from ctx.
              {}
            : m.kind === 'DELIVER_ORDER'
            ? {
                // The photo wins when both are present — it is the evidence
                // that survives a dispute. proofValue holds the object key,
                // never a presigned URL, which would be dead within the hour.
                ...(m.proofKey
                  ? { proofType: 'PHOTO' as const, proofValue: m.proofKey }
                  : m.receivedBy
                    ? { proofType: 'SIGNATURE' as const, proofValue: m.receivedBy }
                    : {}),
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

  return withCors(request, NextResponse.json({ results, at: new Date().toISOString() }))
}

export const OPTIONS = preflight
