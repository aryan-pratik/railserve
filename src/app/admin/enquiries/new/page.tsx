import { requireRole } from '@/lib/session'
import { todayIST } from '@/lib/format'
import { PageHeader } from '@/components/ui'
import { EnquiryForm } from './EnquiryForm'

export const metadata = { title: 'New enquiry · RailServe' }

export default async function NewEnquiryPage() {
  await requireRole('ADMIN')
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        back={{ href: '/admin/enquiries', label: 'All enquiries' }}
        title="New bulk enquiry"
        note="Paste a WhatsApp message, correct what the parser got wrong, then quote."
      />
      <EnquiryForm today={todayIST()} />
    </div>
  )
}
