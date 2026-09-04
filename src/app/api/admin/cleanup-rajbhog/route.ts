import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, Order } from '@/lib/models'

export const dynamic = 'force-dynamic'

/**
 * One-off: hard-delete the inactive "RAJBHOG" outlet, superseded by the
 * active "RajBhog Khana" outlet. Temporary route — remove after use.
 * See scripts/delete-rajbhog-outlet.ts for the equivalent local script.
 */
async function handle() {
  await requireRole('ADMIN')
  await connectDb()

  const candidates = await Restaurant.find({
    active: false,
    $or: [{ name: /rajbhog/i }, { aliases: /rajbhog/i }],
  })

  if (candidates.length !== 1) {
    return NextResponse.json(
      {
        ok: false,
        error: `Expected exactly 1 inactive rajbhog match, found ${candidates.length}`,
        candidates: candidates.map((r) => ({ id: String(r._id), name: r.name })),
      },
      { status: 409 },
    )
  }

  const r = candidates[0]
  const orderCount = await Order.countDocuments({ restaurantId: r._id })

  if (orderCount > 0) {
    return NextResponse.json(
      { ok: false, error: `${orderCount} order(s) reference this outlet, refusing to delete` },
      { status: 409 },
    )
  }

  await Restaurant.deleteOne({ _id: r._id })

  return NextResponse.json({ ok: true, deleted: { id: String(r._id), name: r.name } })
}

export const GET = handle
export const POST = handle
