import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { contextOf, loadUser } from './tenancy/userContext'
import type { AuthContext } from './authContext'
import { can } from './access'
import type { Permission } from './permissions'
import { ROLE_HOME, type Role } from './roles'
import type { PageKey } from './pageAccess'

/**
 * Turns the request's session into an AuthContext.
 *
 * Memoised per render pass with React's cache() so a page that calls it in
 * three components does not decode the session three times.
 *
 * Plan §5 and the Next.js docs agree on the shape here: authorization checks
 * belong next to the data, not in a layout. A layout does not control whether
 * its route segments render, so a layout-level check is decoration, not a gate.
 */
/**
 * The signed-in user as the database holds them right now.
 *
 * The JWT is only proof of *who* the caller is. Role, outlets and active flag
 * are read fresh, because a token freezes them at login: an outlet assigned
 * afterwards would stay invisible until the user signed out and in again, and
 * a deactivated user would keep access until the cookie expired. One indexed
 * lookup by _id, memoised per render pass.
 */
const getFreshUser = cache(async () => {
  const session = await auth()
  if (!session?.user?.id) return null
  return loadUser(session.user.id)
})

/**
 * The caller as the app sees them. An applicant whose company is still
 * joining has no context: to every page, action and repository they are not
 * signed in, so nothing beyond the onboarding screen can be reached or used.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const user = await getFreshUser()
  return user && !user.onboarding ? contextOf(user) : null
})

export const getSessionUser = getFreshUser

/**
 * Sends a caller with no usable user to login. A cookie that still verifies
 * but points at a missing or deactivated user must be cleared first, or the
 * proxy would bounce them straight back from /login.
 */
export async function redirectToLogin(): Promise<never> {
  const session = await auth()
  redirect(session?.user ? '/api/session/reset' : '/login')
}

/** Redirects to login when unauthenticated. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (ctx) return ctx
  // Signed in, but their company is still joining: the onboarding screen.
  if ((await getFreshUser())?.onboarding) redirect('/onboarding')
  return redirectToLogin()
}

/** The owner of a company that is still joining. Anyone already let in goes to their home. */
export async function requireApplicant(): Promise<{ tenantId: string; userId: string; name: string }> {
  const user = await getFreshUser()
  if (!user) return redirectToLogin()
  if (!user.onboarding) redirect('/')
  return { tenantId: user.tenantId, userId: user.id, name: user.name }
}

/** Redirects to the caller's own home when they hold the wrong role. */
export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const ctx = await requireAuth()
  if (!roles.includes(ctx.role)) redirect(ROLE_HOME[ctx.role])
  return ctx
}

/**
 * Redirects to the caller's own home unless their role, as their tenant has
 * configured it, carries the permission. The permission-based successor to
 * requireRole for pages and server actions.
 */
export async function requirePermission(permission: Permission): Promise<AuthContext> {
  const ctx = await requireAuth()
  if (!(await can(ctx, permission))) redirect(ROLE_HOME[ctx.role])
  return ctx
}

/**
 * Redirects home when an admin has switched this page off for the caller
 * (Settings → Staff). Read fresh each request, like role and outlets, so a
 * change takes effect on the next click. Admins are never restricted.
 */
export async function requirePage(page: PageKey): Promise<void> {
  const user = await getFreshUser()
  if (!user) return redirectToLogin()
  if (user.onboarding) redirect('/onboarding')
  if (user.role !== 'ADMIN' && user.hiddenPages.includes(page)) redirect(ROLE_HOME[user.role])
}

/** The pages switched off for the caller, for the sidebar. */
export async function hiddenPagesForCaller(): Promise<string[]> {
  const user = await getFreshUser()
  return user && user.role !== 'ADMIN' ? user.hiddenPages : []
}

/** Our own super admins only; everyone else gets a 404, not a hint that the page exists. */
export async function requirePlatformAdmin(): Promise<AuthContext> {
  const user = await getFreshUser()
  if (!user) return redirectToLogin()
  if (!user.platformAdmin) notFound()
  return contextOf(user)
}
