import { NextResponse } from 'next/server'
import { connectDb } from '@/lib/db'
import { PrintJob, Restaurant } from '@/lib/models'

export const dynamic = 'force-dynamic'

/**
 * The one endpoint a kitchen's print agent calls, forever, on a loop. It
 * never sees a user session — just the outlet's own bearer token — because
 * the agent runs unattended on a device in the kitchen, not as someone
 * logged in. Claims (not just reads) the job it returns so two agent
 * instances, or the same one retrying after a crash, can't both grab it.
 */
export async function GET(req: Request) {
  const token = req.headers.get('x-agent-token')
  if (!token) return NextResponse.json({ ok: false, error: 'Missing x-agent-token' }, { status: 401 })

  await connectDb()
  const restaurant = await Restaurant.findOne({ printAgentToken: token, active: true }).select('_id')
  if (!restaurant) return NextResponse.json({ ok: false, error: 'Invalid agent token' }, { status: 401 })

  const job = await PrintJob.findOneAndUpdate(
    { restaurantId: restaurant._id, status: 'pending' },
    { $set: { status: 'claimed', claimedAt: new Date() } },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  )

  if (!job) return NextResponse.json({ ok: true, job: null })

  return NextResponse.json({
    ok: true,
    job: {
      id: String(job._id),
      images: job.images.map((buf) => buf.toString('base64')),
    },
  })
}
