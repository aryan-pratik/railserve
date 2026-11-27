import { redirect } from 'next/navigation'
import { getSessionUser, redirectToLogin } from '@/lib/session'
import { V2_HOME } from '@/lib/v2/nav'

/**
 * Role dispatcher. Login lands here because the role is only known after the
 * credentials have been verified. Points at the v2 home for each role while
 * the rebuild lands; the v1 screens stay reachable by URL.
 */
export default async function Home() {
  const user = await getSessionUser()
  if (!user) return redirectToLogin()
  // A company still joining has only the onboarding screen.
  if (user.onboarding) redirect('/onboarding')
  redirect(V2_HOME[user.role])
}
