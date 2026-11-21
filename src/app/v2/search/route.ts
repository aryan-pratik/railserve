import { requireAuth } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { findMany } from '@/lib/repo/orderRepo'
import { orderSearchClause, escapeRegExp } from '@/lib/repo/orderSearch'
import { User } from '@/lib/models'
import { runKeyFor } from '@/lib/runs'
import { formatShortDate } from '@/lib/format'
import { statusChip } from '@/components/v2/ui'

export const dynamic = 'force-dynamic'

export type SearchHit = { id: string; title: string; sub: string; href: string; tone?: string; kind: 'order' | 'run' | 'rider' }

/**
 * The ⌘K palette's data: orders by the same search the Orders table uses
 * (ids, names, phones, trains, seats, items), the runs those orders sit on,
 * and riders by name. Scoped to the caller through the repo; telecallers get
 * no amounts because nothing here carries one.
 */
export async function GET(request: Request) {
  const ctx = await requireAuth()
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 80)
  if (q.length < 2) return Response.json({ orders: [], runs: [], riders: [] }, { headers: { 'Cache-Control': 'no-store' } })

  await connectDb()
  const clause = await orderSearchClause(ctx, q)
  const rx = { $regex: escapeRegExp(q), $options: 'i' }
  const [orders, riderDocs] = await Promise.all([
    clause ? findMany(ctx, clause, { sort: { createdAt: -1 }, limit: 8 }) : Promise.resolve([]),
    ctx.role === 'TELECALLER'
      ? Promise.resolve([])
      : User.find({
          tenantId: ctx.tenantId,
          role: 'DELIVERY_AGENT',
          name: rx,
          ...(ctx.role === 'ADMIN' ? {} : { restaurantIds: { $in: ctx.restaurantIds } }),
        })
          .select('name phone')
          .limit(4)
          .lean(),
  ])

  const orderHits: SearchHit[] = orders.map((o) => ({
    kind: 'order',
    id: String(o._id),
    title: `${o.externalOrderId} · ${o.contactName ?? 'No name'}`,
    sub: [o.trainNo, o.coach ? `${o.coach}${o.berth ? `·${o.berth}` : ''}` : o.rawSeat, formatShortDate(o.serviceDate)].filter(Boolean).join(' · '),
    href: `/v2/orders/${String(o._id)}`,
    tone: statusChip(o.status).label,
  }))

  const seen = new Set<string>()
  const runHits: SearchHit[] = []
  for (const o of orders) {
    if (!o.trainNo) continue
    const key = runKeyFor(o)
    if (seen.has(key)) continue
    seen.add(key)
    runHits.push({
      kind: 'run',
      id: key,
      title: `${o.trainNo} ${o.trainName ?? ''}`.trim(),
      sub: `${o.stationCode} · ${formatShortDate(o.serviceDate)}`,
      href: `/v2/kitchen${o.serviceDate ? `?date=${o.serviceDate}` : ''}#${encodeURIComponent(key)}`,
    })
    if (runHits.length >= 4) break
  }

  const riderHits: SearchHit[] = riderDocs.map((r) => ({
    kind: 'rider',
    id: String(r._id),
    title: r.name,
    sub: 'Rider',
    href: `/v2/riders/${String(r._id)}`,
  }))

  return Response.json({ orders: orderHits, runs: runHits, riders: riderHits }, { headers: { 'Cache-Control': 'no-store' } })
}
