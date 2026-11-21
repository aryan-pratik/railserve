import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { findRun } from '@/lib/repo/runRepo'
import { dietLookupFor } from '@/lib/repo/menuRepo'
import { runTrainLabel } from '@/lib/runs'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { runAnchor } from '@/lib/v2/kitchenView'
import { KotTickets } from '@/components/KotTicket'
import { KitchenReprintButton } from '@/components/v2/KitchenReprintButton'
import { KitchenPrintButton } from '@/components/v2/KitchenRunActions'
import { env } from '@/lib/env'
import { runTimingFor } from '@/lib/v2/kitchen'
import { PageHeader } from '@/components/v2/Table'
import { Mono, cx, v2Focus } from '@/components/v2/ui'

export const metadata = { title: 'KOT preview · RailServe' }

/**
 * The KOTs for one train: the orders waiting for one (ACCEPTED) and the ones
 * in the kitchen now (KOT_PRINTED). The tickets themselves are the shared
 * renderer the print queue uses, so what is previewed is what prints.
 *
 * Reprint here covers only the KOT_PRINTED orders; the board's "Print N
 * KOTs" is what sends the ACCEPTED ones, with the status change.
 */
export default async function KitchenKotPage(props: { params: Promise<{ runKey: string }> }) {
  const ctx = await requirePermission('kitchen.operate')
  const { runKey: raw } = await props.params
  const runKey = decodeURIComponent(raw)

  const run = await findRun(ctx, runKey)
  const orders = (run?.orders ?? []).filter((o) => o.status === 'ACCEPTED' || o.status === 'KOT_PRINTED')
  if (!run || orders.length === 0) notFound()
  const reprintable = orders.filter((o) => o.status === 'KOT_PRINTED').length
  const printable = orders.length - reprintable
  const timing = printable > 0 ? await runTimingFor(run) : null

  await connectDb()
  const outletIds = orders.map((o) => o.restaurantId).filter((id) => id != null)
  const outlets = await Restaurant.find({ _id: { $in: outletIds }, tenantId: ctx.tenantId }).select('name stationName').lean()
  const outletById = new Map(outlets.map((o) => [String(o._id), o]))
  const lookup = await dietLookupFor(ctx.tenantId, orders)

  return (
    <div className="grid gap-[18px]">
      <Link
        href={`/v2/kitchen#${runAnchor(runKey)}`}
        className={cx('inline-flex w-fit items-center gap-1.5 rounded-full text-sm font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}
      >
        <ArrowLeft size={15} aria-hidden />
        Back to the board
      </Link>
      <PageHeader
        title={
          <>
            KOTs · <Mono>{runTrainLabel(run)}</Mono>
          </>
        }
        note={`${orders.length} order${orders.length === 1 ? '' : 's'} · ${run.trainName ?? run.stationCode} · ${printable} waiting to print · ${reprintable} already in the kitchen`}
        actions={
          <>
            {printable > 0 ? (
              <KitchenPrintButton
                run={{
                  runKey,
                  trainLabel: runTrainLabel(run),
                  delayMinutes: timing?.delayMinutes ?? null,
                  etaIso: timing?.etaIso ?? null,
                  delayThresholdMinutes: env.KOT_DELAY_THRESHOLD_MINUTES,
                  riders: [],
                  kotHref: '',
                }}
                count={printable}
              />
            ) : null}
            {reprintable > 0 ? <KitchenReprintButton runKey={runKey} count={reprintable} /> : null}
          </>
        }
      />
      <div className="flex flex-col items-center gap-4 rounded-v2-lg border border-v2-line bg-v2-sunken p-6">
        {orders.map((order) => (
          <KotTickets key={String(order._id)} order={order} outlet={outletById.get(String(order.restaurantId)) ?? null} lookup={lookup} />
        ))}
      </div>
    </div>
  )
}
