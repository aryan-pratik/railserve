import { NextResponse } from 'next/server'
import { contextFromBearer } from '@/lib/mobile/token'
import { findMany } from '@/lib/repo/orderRepo'
import { preflight, withCors } from '@/lib/mobile/cors'

export const dynamic = 'force-dynamic'

/**
 * What this rider has already finished.
 *
 * /api/mobile/runs deliberately returns only live work, so a delivered order
 * vanishes the moment it is closed. That is right for the job list and wrong
 * for the rider, who needs to be able to answer "did I deliver that one?" and
 * see the cash they are accountable for at the end of a shift.
 *
 * Filtered by delivery.agentIds rather than by outlet: this is the rider's own
 * record, not their outlet's. The repo still applies outlet scoping on top, so
 * a rider moved between outlets cannot read back orders they never touched.
 */
export async function GET(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 50, 200)

  const orders = await findMany(
    ctx,
    { status: { $in: ['DELIVERED', 'FAILED'] }, 'delivery.agentIds': ctx.userId },
    { sort: { 'delivery.deliveredAt': -1, updatedAt: -1 }, limit },
  )

  return withCors(request, NextResponse.json({
    fetchedAt: new Date().toISOString(),
    orders: orders.map((o) => ({
      id: String(o._id),
      status: o.status,
      trainNo: o.trainNo,
      trainName: o.trainName,
      coach: o.coach,
      berth: o.berth,
      handoverPoint: o.handoverPoint,
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      amountPaise: o.amountPaise,
      paymentMode: o.paymentMode,
      itemCount: o.items.filter((i) => !i.isPacking).length,
      deliveredAt: o.delivery.deliveredAt?.toISOString() ?? null,
      receivedBy: o.delivery.proofType === 'SIGNATURE' ? o.delivery.proofValue : null,
      amountCollectedPaise: o.delivery.amountCollectedPaise ?? null,
      failureReason: o.delivery.failureReason ?? null,
    })),
  }))
}

export const OPTIONS = preflight
