import { redirect } from 'next/navigation'
import { getSessionUser, redirectToLogin } from '@/lib/session'
import { ROLE_HOME } from '@/lib/roles'

/**
 * Role dispatcher. Login lands here because the role is only known after the
 * credentials have been verified.
 */
export default async function Home() {
  const user = await getSessionUser()
  if (!user) return redirectToLogin()
  redirect(ROLE_HOME[user.role])
}
