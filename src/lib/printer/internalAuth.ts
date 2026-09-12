import mongoose from 'mongoose'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { env } from '@/lib/env'
import type { AuthContext } from '@/lib/authContext'

/**
 * Guards the /internal/print/* pages: the only caller is this server's own
 * headless-browser screenshot step (see printer/screenshot.ts), never a real
 * user, so there's no session to check — just a shared secret it sends as a
 * header. Renders as 404 rather than 401/403 so the route doesn't advertise
 * that a valid token would get you somewhere.
 */
export async function requireInternalRenderToken(): Promise<void> {
  const token = (await headers()).get('x-print-render-token')
  if (!env.PRINT_RENDER_TOKEN || token !== env.PRINT_RENDER_TOKEN) notFound()
}

/**
 * Full-access read context for internal rendering. Safe only because this
 * module is reachable exclusively through requireInternalRenderToken above —
 * an ADMIN-shaped ctx bypasses every outlet scope, which is exactly what a
 * server-to-itself render needs and exactly why the token check must run
 * first on every call site.
 */
export const INTERNAL_CTX: AuthContext = {
  userId: new mongoose.Types.ObjectId(),
  role: 'ADMIN',
  restaurantIds: [],
}
