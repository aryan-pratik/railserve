import { signOut } from '@/auth'

/**
 * Clears a session cookie whose user no longer exists or was deactivated.
 *
 * A server component cannot delete cookies, and bouncing such a user to /login
 * alone would loop: the proxy still sees a valid cookie there and sends them
 * straight back. This route is outside the proxy matcher (`api` is excluded),
 * so it can drop the cookie and then land on the login page cleanly.
 */
export async function GET() {
  await signOut({ redirectTo: '/login' })
}
