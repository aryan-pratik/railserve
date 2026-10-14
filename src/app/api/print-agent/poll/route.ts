import { NextResponse } from 'next/server'
import { connectDb } from '@/lib/db'
import { PrintJob, Station } from '@/lib/models'
import { expireStalePrintJobs, reclaimAbandonedPrintJobs, waitForPrintJob } from '@/lib/printer/queue'
import type { PrintJobDoc } from '@/lib/models/PrintJob'

export const dynamic = 'force-dynamic'

/**
 * How long a poll may be held open waiting for a ticket. Well inside nginx's
 * default 60s proxy_read_timeout, and the agent's own request timeout must be
 * longer still: a job claimed into a request the agent has already given up
 * on would sit `claimed` forever and never print.
 */
const MAX_WAIT_MS = 20_000
/** Re-reads the queue this often while waiting, in case a wake-up never comes. */
const RECHECK_MS = 1_000
/** Most jobs one poll hands out — a long train, not the whole backlog. */
const MAX_JOBS = 12

/**
 * The one endpoint a kitchen's print agent calls, forever, on a loop. It
 * never sees a user session — just the station's own bearer token — because
 * the agent runs unattended on a device in the kitchen, not as someone
 * logged in. Claims (not just reads) the jobs it returns so two agent
 * instances, or the same one retrying after a crash, can't both grab them.
 *
 * With no query parameters this answers at once with at most one job — what
 * every agent installed before ?wait existed expects. A current agent asks
 * for `?wait=20&max=12`: the request is held until a ticket is queued (the
 * enqueue wakes it, see notifyPrintAgents), and then hands out the whole
 * train at once. That is what takes the 3s poll interval out of the time
 * between a click and the printer starting.
 */
export async function GET(req: Request) {
  const token = req.headers.get('x-agent-token')
  if (!token) return NextResponse.json({ ok: false, error: 'Missing x-agent-token' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const waitMs = clamp(Number(params.get('wait')) * 1000, 0, MAX_WAIT_MS)
  const max = clamp(Math.floor(Number(params.get('max'))), 1, MAX_JOBS)

  await connectDb()
  const station = await Station.findOne({ printAgentToken: token, active: true }).select('_id')
  if (!station) return NextResponse.json({ ok: false, error: 'Invalid agent token' }, { status: 401 })
  const stationCode = String(station._id)

  // The agent calls this every few seconds forever, so liveness is free to
  // collect here and is the only thing that can tell an idle kitchen apart
  // from a dead agent.
  await Station.updateOne({ _id: station._id }, { $set: { agentLastSeenAt: new Date() } })

  // Before the expiry, so a ticket lost to a dead connection is still printed
  // if the kitchen is still waiting for it, and retired with the rest if not.
  await reclaimAbandonedPrintJobs(stationCode)
  // An agent that starts after a gap must not print the backlog it missed.
  const cutoff = await expireStalePrintJobs([stationCode])

  const claim = async (): Promise<PrintJobDoc[]> => {
    const jobs: PrintJobDoc[] = []
    while (jobs.length < max) {
      // Checked before every claim: an agent that has hung up can never
      // receive the job, and a claimed job nobody prints is a lost ticket.
      if (req.signal.aborted) break
      const job = await PrintJob.findOneAndUpdate(
        { stationCode, status: 'pending', createdAt: { $gte: cutoff } },
        { $set: { status: 'claimed', claimedAt: new Date() } },
        // _id breaks a same-millisecond tie: a train's tickets are queued back
        // to back as one job each, and must still print in order.
        { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' },
      )
      if (!job) break
      jobs.push(job)
    }
    return jobs
  }

  const deadline = Date.now() + waitMs
  let jobs = await claim()
  while (jobs.length === 0 && !req.signal.aborted && Date.now() < deadline) {
    await waitForPrintJob(stationCode, Math.min(RECHECK_MS, deadline - Date.now()), req.signal)
    jobs = await claim()
  }

  const payload = jobs.map((job) => ({
    id: String(job._id),
    images: job.images.map((buf) => buf.toString('base64')),
  }))
  // `job` is the shape every agent understands; `jobs` is the batch.
  return NextResponse.json({ ok: true, job: payload[0] ?? null, jobs: payload })
}

function clamp(n: number, min: number, maxValue: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, min), maxValue) : min
}
