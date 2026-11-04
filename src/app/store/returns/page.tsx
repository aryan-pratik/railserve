import { requireRole } from '@/lib/session'
import { ReturnsScreen } from '@/components/ReturnsScreen'

export const metadata = { title: 'Returns · RailServe' }

/** Bags coming back to this manager's outlets, and the ones already taken back. */
export default async function StoreReturnsPage(props: PageProps<'/store/returns'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  return (
    <ReturnsScreen
      ctx={ctx}
      basePath="/store/returns"
      orderBasePath="/store/orders"
      searchParams={await props.searchParams}
    />
  )
}
