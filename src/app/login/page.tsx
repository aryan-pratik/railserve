import Link from 'next/link'
import { AuthFrame } from '@/components/v2/AuthFrame'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · RailServe' }

/**
 * The first screen anyone sees, so it wears the v2 look (AuthFrame). The
 * sign-in itself is unchanged (phone + password, `login` action). A new
 * company applies from here.
 */
export default function LoginPage() {
  return (
    <AuthFrame>
      <div>
        <h2 className="text-[26px] font-bold tracking-[-0.03em]">Sign in</h2>
        <p className="mt-1 text-sm text-v2-muted">Use the phone number your manager set up for you.</p>
      </div>
      <LoginForm />
      <p className="border-t border-v2-line pt-5 text-sm text-v2-muted">
        Run a train food business?{' '}
        <Link href="/signup" className="font-semibold text-v2-brand hover:underline">
          Apply to join RailServe
        </Link>
      </p>
    </AuthFrame>
  )
}
