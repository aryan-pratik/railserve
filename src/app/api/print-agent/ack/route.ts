import { NextResponse } from 'next/server'
import { z } from 'zod'
import { connectDb } from '@/lib/db'
import { PrintJob, Restaurant } from '@/lib/models'

export const dynamic = 'force-dynamic'

const Body = z.object({
  jobId: z.string().min(1),
  status: z.enum(['done', 'failed']),
  error: z.string().optional(),
})

/** The agent calls this once it has actually sent a job to the printer (or given up on it). */
export async function POST(req: Request) {
  const token = req.headers.get('x-agent-token')
  if (!token) return NextResponse.json({ ok: false, error: 'Missing x-agent-token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  await connectDb()
  const restaurant = await Restaurant.findOne({ printAgentToken: token, active: true }).select('_id')
  if (!restaurant) return NextResponse.json({ ok: false, error: 'Invalid agent token' }, { status: 401 })

  const { jobId, status, error } = parsed.data
  const res = await PrintJob.updateOne(
    { _id: jobId, restaurantId: restaurant._id, status: 'claimed' },
    { $set: { status, doneAt: new Date(), error: error ?? null } },
  )

  if (res.matchedCount === 0) {
    return NextResponse.json({ ok: false, error: 'Job not found or not claimed by you' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
