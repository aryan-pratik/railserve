import { headers } from 'next/headers'
import { connectDb } from '@/lib/db'
import { PrintJob } from '@/lib/models'
import { env } from '@/lib/env'
import { renderKotScreenshots } from '@/lib/printer/screenshot'
import { parseRunKey } from '@/lib/runs'
import { normaliseStationCode } from '@/lib/stations'
import type mongoose from 'mongoose'

/**
 * Everything in this file renders a ticket and queues it for an outlet's
 * local print agent — this server never talks to the kitchen printer's
 * private IP itself (it can't, from a data-center VM; see agent/README.md).
 * The agent polls /api/print-agent/poll and does the actual last-hop
 * delivery.
 */

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

  await connectDb()
  await PrintJob.create({
    stationCode: normaliseStationCode(stationCode),
    restaurantId,
    refType: 'order',
    refId: orderId,
    images,
    status: 'pending',
  })
}

/**
 * One page render, one PrintJob. A run is (train, date, station) by
 * construction — it cannot span stations, and every brand trading at a
 * station shares one printer, so there is nothing left to fan out to.
 *
 * `orderIds` is the set the *caller* is entitled to print, and the render
 * page filters to exactly it. The internal page runs under an ADMIN-shaped
 * context that bypasses outlet scoping, so without that filter a manager
 * holding one brand would get every brand's tickets.
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
  if (images.length !== orderIds.length) {
    throw new Error(
      `Rendered ${images.length} ticket(s) but asked for ${orderIds.length} order(s)`,
    )
  }

  await connectDb()
  await PrintJob.create({
    stationCode: normaliseStationCode(identity.stationCode),
    // A run spans brands; the run key is the provenance.
    restaurantId: null,
    refType: 'run',
    refId: runKey,
    images,
    status: 'pending',
  })
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
