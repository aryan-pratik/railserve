import { cache } from 'react'
import mongoose from 'mongoose'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { connectDb } from './db'
import { User } from './models'
import type { AuthContext } from './authContext'
import { ROLE_HOME, type Role } from './roles'

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
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return null

  await connectDb()
  const user = await User.findOne({ _id: session.user.id, active: true })
    .select('name role restaurantIds')
    .lean()
  if (!user) return null

  return {
    id: String(user._id),
    name: user.name ?? '',
    role: user.role,
    restaurantIds: (user.restaurantIds ?? []).map(String),
  }
})

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const user = await getFreshUser()
  if (!user) return null

  return {
    userId: new mongoose.Types.ObjectId(user.id),
    role: user.role,
    restaurantIds: user.restaurantIds.map((id) => new mongoose.Types.ObjectId(id)),
  }
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
  if (!ctx) return redirectToLogin()
  return ctx
}

/** Redirects to the caller's own home when they hold the wrong role. */
export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const ctx = await requireAuth()
  if (!roles.includes(ctx.role)) redirect(ROLE_HOME[ctx.role])
  return ctx
}
