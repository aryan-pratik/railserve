import { requireRole } from '@/lib/session'
import { PaymentsScreen } from '@/components/PaymentsScreen'

export const metadata = { title: 'Payments · RailServe' }

/**
 * The same shared ledger store manager sees, minus the account balance and
 * the export — a telecaller only needs to confirm a passenger's payment
 * landed when they call in disputing a charge, never to reconcile the bank
 * account. See the note on CallsLayout for why this is now a narrow
 * exception to that section's usual "no money" rule.
 */
export default async function CallsPaymentsPage(props: PageProps<'/calls/payments'>) {
  const ctx = await requireRole('TELECALLER')
  return (
    <PaymentsScreen
      ctx={ctx}
      basePath="/calls/payments"
      searchParams={await props.searchParams}
    />
  )
}
