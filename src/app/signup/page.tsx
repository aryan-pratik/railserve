import Link from 'next/link'
import { FileCheck2, Mail, BadgeIndianRupee } from 'lucide-react'
import { AuthFrame } from '@/components/v2/AuthFrame'
import { SignupForm } from './SignupForm'

export const metadata = { title: 'Apply to join · RailServe' }

/** A new company applies: an account first, then the onboarding screen walks them through the rest. */
export default function SignupPage() {
  return (
    <AuthFrame
      wide
      headline="Bring your train food business to RailServe."
      points={[
        <><FileCheck2 size={18} className="text-v2-mint" aria-hidden /> 1. Upload 5 documents. We check them within a day or two.</>,
        <><Mail size={18} className="text-v2-mint" aria-hidden /> 2. Link the Gmail your aggregator orders arrive in.</>,
        <><BadgeIndianRupee size={18} className="text-v2-mint" aria-hidden /> 3. Pay the joining fee. Then you are in.</>,
      ]}
    >
      <div>
        <h2 className="text-[26px] font-bold tracking-[-0.03em]">Apply to join</h2>
        <p className="mt-1 text-sm text-v2-muted">Create your account. Next, we will ask for your documents.</p>
      </div>
      <SignupForm />
      <p className="text-sm text-v2-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-v2-brand hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  )
}
