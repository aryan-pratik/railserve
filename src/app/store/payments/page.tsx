import { requireRole } from '@/lib/session'
import { PaymentsScreen } from '@/components/PaymentsScreen'

export const metadata = { title: 'Payments · RailServe' }

/**
 * The same ledger the admin sees, minus the account balance and the export.
 *
 * Payments are not outlet-scoped — one shared bank account, and a credit
 * alert names a payer and nothing that says which kitchen it belongs to — so
 * every manager sees every payment. That is a deliberate exception to the
 * isolation rule the orders repository enforces, not an oversight in it.
 */
export default async function StorePaymentsPage(props: PageProps<'/store/payments'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  return (
    <PaymentsScreen
      ctx={ctx}
      basePath="/store/payments"
      searchParams={await props.searchParams}
    />
  )
}
