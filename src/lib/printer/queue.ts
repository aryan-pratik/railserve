import { headers } from 'next/headers'
import { connectDb } from '@/lib/db'
import { PrintJob, Station } from '@/lib/models'
import { env } from '@/lib/env'
import { renderKotScreenshots } from '@/lib/printer/screenshot'
import { printImagesDirect } from '@/lib/printer/directPrint'
import { parseRunKey } from '@/lib/runs'
import { normaliseStationCode } from '@/lib/stations'
import type mongoose from 'mongoose'
import type { PrintJobDoc } from '@/lib/models/PrintJob'

/**
 * Everything in this file renders a ticket and queues it for delivery to a
 * station's kitchen printer, one of two ways:
 *
 * - Most stations: the server never talks to the printer's private IP itself
 *   (it can't, from a data-center VM; see agent/README.md) — a local agent
 *   polls /api/print-agent/poll and does the actual last-hop delivery.
 * - A station with `Station.directPrinterHost` set (its router port-forwards
 *   the printer to a public IP): delivered straight from here, right after
 *   the job is created, no agent involved. tryDirectDeliver() below is the
 *   best-effort attempt at enqueue time; /api/cron/print-retry catches
 *   anything that failed (printer briefly offline, etc).
 */

/**
 * Attempts immediate delivery for a station configured for direct printing.
 * Leaves the job `pending` (with `error` set) on failure rather than
 * throwing — the enqueue call already rendered and saved the job, and a
 * printer being briefly unreachable is not a reason to fail the caller;
 * the retry cron picks it up from `pending`.
 *
 * Returns false only when a delivery was attempted and failed.
 */
async function tryDirectDeliver(job: PrintJobDoc): Promise<boolean> {
  const station = await Station.findById(job.stationCode).select('directPrinterHost directPrinterPort')
  if (!station?.directPrinterHost) return true

  try {
    await printImagesDirect(job.images, station.directPrinterHost, station.directPrinterPort ?? 9100)
    await PrintJob.updateOne({ _id: job._id }, { $set: { status: 'done', doneAt: new Date() } })
    await Station.updateOne({ _id: station._id }, { $set: { agentLastPrintedAt: new Date() } })
    return true
  } catch (err) {
    await PrintJob.updateOne(
      { _id: job._id },
      { $set: { error: err instanceof Error ? err.message : String(err) } },
    )
    return false
  }
}

/**
 * For a Server Action, unlike a Route Handler, there's no `req.url` to read
 * an origin from — only the incoming request's headers. nginx sets
 * x-forwarded-* in production (see docs/DEPLOY.md); falls back to `host` for
 * local dev, where the app is its own front door.
 */
export async function getAppOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** Every order prints as this many tickets, each with its own cut: the KOT and the bag slip. */
export const TICKETS_PER_ORDER = 2

/**
 * One PrintJob per ticket, never one job holding several.
 *
 * A single-order KOT has always come out of the printer cut correctly; a
 * train's batch, sent as one job of N images, came out as one long uncut
 * strip. The agent and direct paths both cut between a job's images, but
 * only if the deployed agent is new enough and the printer drains each
 * write before the next connection lands, and neither is something the
 * server can see. A one-ticket job prints exactly the way a single order
 * always has, whatever agent the kitchen runs, and a failed job reprints
 * one ticket rather than the whole train.
 *
 * Jobs are created one by one so `createdAt`, the agent's claim order, keeps
 * the tickets in print order.
 */
async function enqueueTickets(params: {
  stationCode: string
  restaurantId: mongoose.Types.ObjectId | string | null
  refType: 'order' | 'run'
  refId: string
  images: Buffer[]
}): Promise<void> {
  const { images, ...ref } = params
  await connectDb()

  const jobs: PrintJobDoc[] = []
  for (const image of images) {
    jobs.push(
      await PrintJob.create({
        ...ref,
        stationCode: normaliseStationCode(ref.stationCode),
        images: [image],
        status: 'pending',
      }),
    )
  }
  // Stop at the first failure: the printer is down, the rest would only wait
  // out the same timeout one by one, and printing past a gap would put the
  // train's tickets out of order. The retry cron sends them all, oldest first.
  for (const job of jobs) {
    if (!(await tryDirectDeliver(job))) break
  }
}

export async function enqueueOrderKotPrint(params: {
  appOrigin: string
  stationCode: string
  /** Provenance only — a job is routed by station. Null when outlet matching failed. */
  restaurantId?: mongoose.Types.ObjectId | string | null
  orderId: string
}) {
  const { appOrigin, stationCode, restaurantId = null, orderId } = params

  const pagePath = `/internal/print/order/${orderId}`
  const images = await renderKotScreenshots(new URL(pagePath, appOrigin).toString())

  await enqueueTickets({ stationCode, restaurantId, refType: 'order', refId: orderId, images })
}

/**
 * One page render for the whole train, then one PrintJob per ticket (see
 * enqueueTickets). A run is (train, date, station) by construction — it
 * cannot span stations, and every brand trading at a station shares one
 * printer, so every job goes to the same place.
 *
 * `orderIds` is the set the *caller* means to print, and the render page
 * filters to exactly it. The internal page runs under an ADMIN-shaped
 * context that bypasses outlet scoping, so without that filter a manager
 * holding one brand would get every brand's tickets — and the caller is
 * also what keeps a train's not-yet-accepted orders off the printer.
 */
export async function enqueueRunKotPrint(params: {
  appOrigin: string
  runKey: string
  orderIds: string[]
}) {
  const { appOrigin, runKey, orderIds } = params

  const identity = parseRunKey(runKey)
  if (!identity) throw new Error(`Malformed run key: ${runKey}`)
  if (orderIds.length === 0) throw new Error(`Run ${runKey} has no printable orders`)

  const url = new URL(`/internal/print/run/${encodeURIComponent(runKey)}`, appOrigin)
  url.searchParams.set('orders', orderIds.join(','))
  const images = await renderKotScreenshots(url.toString())

  // Now a genuine invariant rather than a coincidence: the page was told
  // which orders to render, so a mismatch means the two disagree.
  const expected = orderIds.length * TICKETS_PER_ORDER
  if (images.length !== expected) {
    throw new Error(
      `Rendered ${images.length} ticket(s) but expected ${expected} for ${orderIds.length} order(s)`,
    )
  }

  await enqueueTickets({
    stationCode: identity.stationCode,
    // A run spans brands; the run key is the provenance.
    restaurantId: null,
    refType: 'run',
    refId: runKey,
    images,
  })
}

/**
 * Retries pending jobs for stations configured for direct printing —
 * everything else (stations still on the poll/agent path) is left alone,
 * since a normal agent will pick those up on its own next poll.
 */
export async function retryDirectPrintJobs(): Promise<{ attempted: number; delivered: number }> {
  await connectDb()

  const directStations = await Station.find({ directPrinterHost: { $ne: null } }).select('_id')
  const stationCodes = directStations.map((s) => s._id)
  if (stationCodes.length === 0) return { attempted: 0, delivered: 0 }

  // Oldest first, so a train's tickets still come out in order on retry.
  const jobs = await PrintJob.find({ status: 'pending', stationCode: { $in: stationCodes } })
    .sort({ createdAt: 1, _id: 1 })
  // A station whose printer failed once this sweep is skipped for the rest
  // of it, so its later tickets never print ahead of the one that failed.
  const down = new Set<string>()
  for (const job of jobs) {
    if (down.has(job.stationCode)) continue
    if (!(await tryDirectDeliver(job))) down.add(job.stationCode)
  }

  const delivered = await PrintJob.countDocuments({
    _id: { $in: jobs.map((j) => j._id) },
    status: 'done',
  })
  return { attempted: jobs.length, delivered }
}

export class PrintAgentNotConfiguredError extends Error {
  constructor() {
    super('PRINT_RENDER_TOKEN is not set: see .env.example')
    this.name = 'PrintAgentNotConfiguredError'
  }
}

export function assertPrintAgentConfigured() {
  if (!env.PRINT_RENDER_TOKEN) throw new PrintAgentNotConfiguredError()
}
