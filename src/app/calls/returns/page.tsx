import { requireRole } from '@/lib/session'
import { ReturnsScreen } from '@/components/ReturnsScreen'

export const metadata = { title: 'Returns · RailServe' }

/**
 * Bags coming back to the outlets this telecaller holds. Read-only unless an
 * admin has let telecallers collect at the counter (Setup → Access).
 */
export default async function CallsReturnsPage(props: PageProps<'/calls/returns'>) {
  const ctx = await requireRole('TELECALLER')
  return (
    <ReturnsScreen
      ctx={ctx}
      basePath="/calls/returns"
      orderBasePath="/calls/orders"
      searchParams={await props.searchParams}
    />
  )
}
