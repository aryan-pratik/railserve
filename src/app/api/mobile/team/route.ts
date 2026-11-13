import { NextResponse } from 'next/server'
import { z } from 'zod'
import { contextFromBearer } from '@/lib/mobile/token'
import { teamView } from '@/lib/repo/teamRepo'
import { settleRiderCash } from '@/lib/repo/riderCashRepo'
import { ConflictError, ForbiddenError } from '@/lib/authContext'
import { preflight, withCors } from '@/lib/mobile/cors'

export const dynamic = 'force-dynamic'

/**
 * A team leader's view of the riders under them.
 *
 * The same figures each rider sees on their own Done tab, for the same
 * reporting day, because both come from the rider ledger. 403 for a rider who
 * leads nobody, which the app reads as "no team tab".
 */
export async function GET(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const day = new URL(request.url).searchParams.get('date') ?? undefined
  try {
    const team = await teamView(ctx, ctx.userId, { day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined })
    return withCors(request, NextResponse.json({ fetchedAt: new Date().toISOString(), ...team }))
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return withCors(request, NextResponse.json({ error: err.message }, { status: 403 }))
    }
    throw err
  }
}

const Receive = z.object({
  riderId: z.string().min(1),
  // The orders the leader was shown, so what they counted is what is settled.
  orderIds: z.array(z.string().min(1)).min(1).max(500),
})

/**
 * A team leader marks a rider's cash as received. Only when an admin has
 * authorised them to, and only for their own team; the repository checks
 * both. Not queued offline like a delivery: receiving money against a stale
 * list is exactly what the order ids are sent to prevent.
 */
export async function POST(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const parsed = Receive.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return withCors(request, NextResponse.json({ error: 'Choose a rider with cash to hand over.' }, { status: 400 }))
  }
  try {
    const r = await settleRiderCash({ ctx, ...parsed.data })
    return withCors(request, NextResponse.json({ ok: true, ...r }))
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : err instanceof ConflictError ? 409 : 500
    return withCors(
      request,
      NextResponse.json({ error: err instanceof Error ? err.message : 'Could not record the handover.' }, { status }),
    )
  }
}

export const OPTIONS = preflight
