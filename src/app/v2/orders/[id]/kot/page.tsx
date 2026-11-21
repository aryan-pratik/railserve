import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { dietLookupFor } from '@/lib/repo/menuRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTickets } from '@/components/KotTicket'
import { ReprintKotButton } from '@/components/v2/OrderKitchen'
import { PageHeader } from '@/components/v2/Table'
import { Mono, cx, v2Focus } from '@/components/v2/ui'

export const metadata = { title: 'KOT preview · RailServe' }

/** Statuses an order can only be in if its KOT has already gone out once. */
const PRINTED = new Set(['KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'DELIVERED', 'FAILED'])

/**
 * The KOT for one order at 80mm thermal width, drawn by the same renderer the
 * print queue uses, so what is previewed is what prints. Reprint sends it to
 * the printer again without touching the status.
 */
export default async function OrderKotPreview(props: PageProps<'/v2/orders/[id]/kot'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { id } = await props.params

  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  const [outlet, lookup] = await Promise.all([
    order.restaurantId ? Restaurant.findById(order.restaurantId).select('name stationName').lean() : Promise.resolve(null),
    dietLookupFor([order]),
  ])

  return (
    <div className="grid gap-[18px]">
      <Link
        href={`/v2/orders/${id}?tab=kitchen`}
        className={cx('inline-flex w-fit items-center gap-1.5 rounded-full text-sm font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}
      >
        <ArrowLeft size={15} aria-hidden />
        Back to the order
      </Link>
      <PageHeader
        title={
          <>
            KOT · <Mono>{order.externalOrderId}</Mono>
          </>
        }
        note={`80mm thermal preview · ${outlet?.name ?? 'no outlet'} · ${order.items.length} line${order.items.length === 1 ? '' : 's'}`}
        actions={PRINTED.has(order.status) ? <ReprintKotButton orderId={id} /> : null}
      />
      <div className="flex flex-col items-center gap-4 rounded-v2-lg border border-v2-line bg-v2-sunken p-6">
        <KotTickets order={order} outlet={outlet} lookup={lookup} />
      </div>
    </div>
  )
}
