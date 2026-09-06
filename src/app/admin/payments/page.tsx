import { requireRole } from '@/lib/session'
import { PaymentsScreen } from '@/components/PaymentsScreen'

export const metadata = { title: 'Payments · RailServe' }

export default async function AdminPaymentsPage(props: PageProps<'/admin/payments'>) {
  const ctx = await requireRole('ADMIN')
  return (
    <PaymentsScreen
      ctx={ctx}
      basePath="/admin/payments"
      privileged
      searchParams={await props.searchParams}
    />
  )
}
