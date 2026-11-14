import { requireRole } from '@/lib/session'
import { ReturnsScreen } from '@/components/ReturnsScreen'

export const metadata = { title: 'Returns · RailServe' }

/** Every bag coming back to any outlet. An admin can always mark one returned. */
export default async function AdminReturnsPage(props: PageProps<'/admin/returns'>) {
  const ctx = await requireRole('ADMIN')
  return (
    <ReturnsScreen
      ctx={ctx}
      basePath="/admin/returns"
      orderBasePath="/admin/orders"
      searchParams={await props.searchParams}
      defaultMode="today"
    />
  )
}
