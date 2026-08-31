import { NextResponse } from 'next/server'
import { connectDb } from '@/lib/db'
import { Order, UnparsedInbox } from '@/lib/models'
import { env } from '@/lib/env'

/** TEMP — one-off diagnostic for the test-order batch. Delete after use. */
export async function GET(request: Request) {
  const expected = env.CRON_TOKEN
  const supplied = request.headers.get('x-cron-token') ?? ''
  if (expected && supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDb()

  const since = new Date(Date.now() - 2 * 60 * 60 * 1000)

  const orders = await Order.find({ createdAt: { $gte: since } })
    .select('source externalOrderId restaurantId contactName createdAt')
    .sort({ createdAt: -1 })
    .lean()

  const unparsed = await UnparsedInbox.find({ createdAt: { $gte: since } })
    .select('source externalOrderId reason detail createdAt')
    .sort({ createdAt: -1 })
    .lean()

  return NextResponse.json({ orders, unparsed })
}
