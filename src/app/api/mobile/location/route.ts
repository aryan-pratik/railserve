import { NextResponse } from 'next/server'
import { z } from 'zod'
import { contextFromBearer } from '@/lib/mobile/token'
import { recordFixes } from '@/lib/repo/riderLocationRepo'
import { MAX_PINGS_PER_REQUEST } from '@/lib/riderLocation'
import { preflight, withCors } from '@/lib/mobile/cors'

export const dynamic = 'force-dynamic'

const Ping = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyMetres: z.number().min(0).nullable().optional(),
  speedMetresPerSecond: z.number().min(0).nullable().optional(),
  headingDegrees: z.number().min(0).max(360).nullable().optional(),
  recordedAt: z.iso.datetime(),
})

const Body = z.object({
  // Plural from the start: a phone that lost signal in a station has several
  // fixes to hand over, and one request beats six.
  pings: z.array(Ping).min(1).max(MAX_PINGS_PER_REQUEST),
})

/**
 * Where the rider is, from the rider's phone.
 *
 * Separate from /api/mobile/mutations on purpose. That queue's contract is
 * retry-until-applied, because a delivery that never reaches the server is
 * work that vanishes; a coordinate has the opposite property — a fix that
 * could not be sent is worthless a minute later, and retrying it forever would
 * redraw a stale path and fill the storage the delivery queue depends on. So
 * location is fire-and-forget: the app keeps a small bounded buffer, sends
 * what it has, and drops whatever the server takes or refuses.
 *
 * Only riders may post. `contextFromBearer` proves who the caller is and that
 * their account is still active, but it does not check the role, and a token
 * issued to a store manager would otherwise put a manager's phone on the
 * rider map.
 */
export async function POST(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  if (ctx.role !== 'DELIVERY_AGENT') {
    return withCors(request, NextResponse.json({ error: 'Riders only' }, { status: 403 }))
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    // Deliberately not echoing the body back in the message: the invalid part
    // of a rejected request here is a coordinate.
    return withCors(request, NextResponse.json({ error: 'Invalid location payload' }, { status: 400 }))
  }

  const { accepted, storedAt } = await recordFixes(
    ctx.userId,
    parsed.data.pings.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      accuracyMetres: p.accuracyMetres ?? null,
      speedMetresPerSecond: p.speedMetresPerSecond ?? null,
      headingDegrees: p.headingDegrees ?? null,
      recordedAt: new Date(p.recordedAt),
    })),
  )

  // `ok` regardless of how many survived sanitising: everything sent has been
  // dealt with, and the phone's buffer should be cleared either way.
  return withCors(
    request,
    NextResponse.json({ ok: true, accepted, storedAt: storedAt?.toISOString() ?? null }),
  )
}

export const OPTIONS = preflight
