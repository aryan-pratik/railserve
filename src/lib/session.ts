import { cache } from 'react'
import mongoose from 'mongoose'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { connectDb } from './db'
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
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await auth()
  if (!session?.user?.id) return null

  await connectDb()

  return {
    userId: new mongoose.Types.ObjectId(session.user.id),
    role: session.user.role,
    restaurantIds: (session.user.restaurantIds ?? []).map(
      (id) => new mongoose.Types.ObjectId(id),
    ),
  }
})

export const getSessionUser = cache(async () => {
  const session = await auth()
  return session?.user ?? null
})

/** Redirects to login when unauthenticated. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  return ctx
}

/** Redirects to the caller's own home when they hold the wrong role. */
export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const ctx = await requireAuth()
  if (!roles.includes(ctx.role)) redirect(ROLE_HOME[ctx.role])
  return ctx
}
