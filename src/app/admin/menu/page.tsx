import { requireRole } from '@/lib/session'
import { menuOverview } from '@/lib/repo/menuRepo'
import { ORDER_SOURCES, SOURCE_LABEL } from '@/lib/orderEnums'
import { PageHeader } from '@/components/ui'
import { MenuBoard } from './MenuBoard'

export const metadata = { title: 'Menu · RailServe' }
export const dynamic = 'force-dynamic'

/**
 * The menu database: every dish each aggregator sends, tagged veg or non-veg.
 *
 * This table is what the KOT splits on, so it is the one place to fix a dish
 * that printed on the wrong ticket. Counts are read from the orders
 * themselves each time (menuRepo.menuOverview), and any dish in an order that
 * the menu has not seen is added on the way.
 */
export default async function AdminMenuPage() {
  const ctx = await requireRole('ADMIN')
  // Taken before the read: a tag saved after this moment may be missing from
  // `rows`, and the board keeps showing its own copy of it (see MenuBoard).
  const asOf = new Date().getTime()
  const rows = await menuOverview(ctx)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Menu"
        note="Every item each aggregator sends, tagged veg or non-veg. Non-veg items always print on their own KOT."
      />
      <MenuBoard
        rows={rows}
        asOf={asOf}
        sources={ORDER_SOURCES.map((s) => ({ id: s, label: SOURCE_LABEL[s] }))}
      />
    </div>
  )
}
