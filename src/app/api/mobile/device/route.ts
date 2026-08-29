import { NextResponse } from 'next/server'
import { z } from 'zod'
import { contextFromBearer } from '@/lib/mobile/token'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'

import { preflight, withCors } from '@/lib/mobile/cors'

export const dynamic = 'force-dynamic'

const Body = z.object({ pushToken: z.string().trim().min(1).nullable() })

/**
 * Registers the device's push token against the user (plan §3: FCM
 * registration). The `fcmToken` field has been on the user schema since day
 * one for exactly this; nothing sends to it yet, because that needs a Firebase
 * service account.
 */
export async function POST(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return withCors(request, NextResponse.json({ error: 'pushToken required' }, { status: 400 }))

  await connectDb()
  await User.updateOne({ _id: ctx.userId }, { $set: { fcmToken: parsed.data.pushToken } })

  return withCors(request, NextResponse.json({ ok: true }))
}

export const OPTIONS = preflight
