import { requireRole } from '@/lib/session'
import { todayIST } from '@/lib/format'
import { EnquiryForm } from './EnquiryForm'

export const metadata = { title: 'New enquiry · RailServe' }

export default async function NewEnquiryPage() {
  await requireRole('ADMIN')
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">New bulk enquiry</h1>
        <p className="mt-1 text-sm text-slate-600">
          Paste a WhatsApp message, correct what the parser got wrong, then quote.
        </p>
      </div>
      <EnquiryForm today={todayIST()} />
    </div>
  )
}
