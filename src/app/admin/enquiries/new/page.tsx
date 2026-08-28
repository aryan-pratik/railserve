import { requireRole } from '@/lib/session'
import { todayIST } from '@/lib/format'
import { ButtonLink, PageHeader } from '@/components/ui'
import { EnquiryForm } from './EnquiryForm'

export const metadata = { title: 'New enquiry · RailServe' }

export default async function NewEnquiryPage() {
  await requireRole('ADMIN')
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="New bulk enquiry"
        note="Paste a WhatsApp message, correct what the parser got wrong, then quote."
        action={
          <ButtonLink href="/admin/enquiries" variant="ghost" size="sm">
            ← All enquiries
          </ButtonLink>
        }
      />
      <EnquiryForm today={todayIST()} />
    </div>
  )
}
