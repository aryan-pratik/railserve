import { NextResponse } from 'next/server'
import { contextFromBearer } from '@/lib/mobile/token'
import { findRuns } from '@/lib/repo/runRepo'
import { timingForOrders, timingFor } from '@/lib/train/service'
import { computeDispatchAt } from '@/lib/train/policy'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { env } from '@/lib/env'
import { todayIST } from '@/lib/format'

import { preflight, withCors } from '@/lib/mobile/cors'

export const dynamic = 'force-dynamic'

/**
 * Today's runs for the authenticated agent, with everything the app needs to
 * render offline afterwards — the phone will lose signal inside the station,
 * so this is a complete snapshot rather than a list of ids to expand later.
 */
export async function GET(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return withCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const serviceDate =
    new URL(request.url).searchParams.get('serviceDate') || todayIST()

  const runs = await findRuns(ctx, serviceDate)
  const timings = await timingForOrders(runs.flatMap((r) => r.orders))

  await connectDb()
  const outlets = await Restaurant.find({}).select('name stationCode walkToPlatformMinutes').lean()
  const walkFor = new Map(outlets.map((o) => [String(o._id), o.walkToPlatformMinutes ?? 10]))
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

  return withCors(request, NextResponse.json({
    serviceDate,
    fetchedAt: new Date().toISOString(),
    runs: runs.map((run) => {
      const t = timingFor(run.orders[0], timings)
      const dispatchAt = computeDispatchAt({
        etaAt: t.effectiveArrival,
        walkToPlatformMinutes: walkFor.get(String(run.orders[0]?.restaurantId)) ?? 10,
        bufferMinutes: env.DISPATCH_BUFFER_MINUTES,
      })

      return {
        key: run.key,
        trainNo: run.trainNo,
        trainName: run.trainName,
        stationCode: run.stationCode,
        serviceDate: run.serviceDate,
        statusCounts: run.statusCounts,
        timing: {
          effectiveArrival: t.effectiveArrival?.toISOString() ?? null,
          source: t.source,
          delayMinutes: t.delayMinutes,
          platform: t.platform,
          ageMinutes: t.ageMinutes,
          stale: t.stale,
        },
        dispatchAt: dispatchAt?.toISOString() ?? null,
        orders: run.orders.map((o) => ({
          id: String(o._id),
          externalOrderId: o.externalOrderId,
          orderType: o.orderType,
          status: o.status,
          outletName: outletName.get(String(o.restaurantId)) ?? null,
          coach: o.coach,
          berth: o.berth,
          rawSeat: o.rawSeat,
          handoverPoint: o.handoverPoint,
          pax: o.pax,
          contactName: o.contactName,
          contactPhone: o.contactPhone,
          amountPaise: o.amountPaise,
          paymentMode: o.paymentMode,
          remark: o.remark ?? null,
          items: o.items.map((i) => ({
            id: String(i._id), name: i.name, qty: i.qty,
            isPacking: i.isPacking, spec: i.spec ?? null,
          })),
          delivery: {
            deliveredAt: o.delivery.deliveredAt?.toISOString() ?? null,
            proofValue: o.delivery.proofValue ?? null,
            amountCollectedPaise: o.delivery.amountCollectedPaise ?? null,
            failureReason: o.delivery.failureReason ?? null,
          },
        })),
      }
    }),
  }))
}

export const OPTIONS = preflight
