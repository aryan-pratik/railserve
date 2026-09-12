import { headers } from 'next/headers'
import { connectDb } from '@/lib/db'
import { PrintJob } from '@/lib/models'
import { env } from '@/lib/env'
import { renderKotScreenshots } from '@/lib/printer/screenshot'
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
  restaurantId: mongoose.Types.ObjectId | string
  orderId: string
}) {
  const { appOrigin, restaurantId, orderId } = params

  const pagePath = `/internal/print/order/${orderId}`
  const images = await renderKotScreenshots(new URL(pagePath, appOrigin).toString())

  await connectDb()
  await PrintJob.create({
    restaurantId,
    refType: 'order',
    refId: orderId,
    images,
    status: 'pending',
  })
}

/**
 * One page render, one ticket per order, split into one PrintJob per
 * outlet — a batch can span kitchens (different outlets on one train), and
 * each outlet's agent must only ever see its own tickets.
 */
export async function enqueueRunKotPrint(params: {
  appOrigin: string
  runKey: string
  orders: { restaurantId?: mongoose.Types.ObjectId | string | null }[]
}) {
  const { appOrigin, runKey, orders } = params

  const pagePath = `/internal/print/run/${encodeURIComponent(runKey)}`
  const images = await renderKotScreenshots(new URL(pagePath, appOrigin).toString())

  if (images.length !== orders.length) {
    throw new Error(
      `Rendered ${images.length} ticket(s) but the run has ${orders.length} order(s)`,
    )
  }

  const imagesByOutlet = new Map<string, Buffer[]>()
  orders.forEach((order, i) => {
    const key = String(order.restaurantId)
    const bucket = imagesByOutlet.get(key) ?? []
    bucket.push(images[i])
    imagesByOutlet.set(key, bucket)
  })

  await connectDb()
  await PrintJob.insertMany(
    [...imagesByOutlet.entries()].map(([restaurantId, outletImages]) => ({
      restaurantId,
      refType: 'run' as const,
      refId: runKey,
      images: outletImages,
      status: 'pending' as const,
    })),
  )
}

export class PrintAgentNotConfiguredError extends Error {
  constructor() {
    super('PRINT_RENDER_TOKEN is not set — see .env.example')
    this.name = 'PrintAgentNotConfiguredError'
  }
}

export function assertPrintAgentConfigured() {
  if (!env.PRINT_RENDER_TOKEN) throw new PrintAgentNotConfiguredError()
}
