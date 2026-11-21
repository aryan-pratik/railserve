import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { z } from 'zod'
import { connectDb } from '@/lib/db'
import { PrintJob, Station } from '@/lib/models'
import { naturalKey } from '@/lib/tenancy/primary'

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
  // The token identifies the tenant (it is unique across the platform), so
  // this lookup runs across tenants; the writes below use the station's own.
  const station = await Station.findOne({ printAgentToken: token, active: true })
    .setOptions({ allTenants: true })
    .select('_id tenantId')
  if (!station) return NextResponse.json({ ok: false, error: 'Invalid agent token' }, { status: 401 })
  const tenantId = station.tenantId

  const { jobId, status, error } = parsed.data
  // A malformed jobId would make Mongoose throw a CastError, which surfaces
  // as a 500 on what is really a bad request from a misbehaving agent.
  if (!mongoose.isValidObjectId(jobId)) {
    return NextResponse.json({ ok: false, error: 'Invalid jobId' }, { status: 400 })
  }

  const res = await PrintJob.updateOne(
    // Jobs carry the natural station code, not the tenant-keyed _id.
    { _id: jobId, tenantId, stationCode: naturalKey(String(station._id)), status: 'claimed' },
    { $set: { status, doneAt: new Date(), error: error ?? null } },
  )

  if (res.matchedCount === 0) {
    return NextResponse.json({ ok: false, error: 'Job not found or not claimed by you' }, { status: 404 })
  }

  if (status === 'done') {
    await Station.updateOne({ _id: station._id, tenantId }, { $set: { agentLastPrintedAt: new Date() } })
  }
  return NextResponse.json({ ok: true })
}
