import { AppSettings, APP_SETTINGS_ID } from '../models'
import { ForbiddenError, type AuthContext } from '../authContext'
import { connectDb } from '../db'
import { DEFAULT_RTO_COLLECT_ROLES, normaliseRtoRoles, type RtoCollectorRole } from '../rto'

/**
 * The admin's app-wide switches (models/AppSettings). Reads fall back to the
 * defaults when the row has never been written, so a fresh install behaves
 * before anyone opens Setup.
 */

export async function getRtoCollectRoles(): Promise<readonly RtoCollectorRole[]> {
  await connectDb()
  const row = await AppSettings.findOne({ _id: APP_SETTINGS_ID }).select('rtoCollectRoles').lean()
  if (!row) return DEFAULT_RTO_COLLECT_ROLES
  return normaliseRtoRoles(row.rtoCollectRoles ?? [])
}

/**
 * Who may collect a return at the counter, besides an admin. Anything that is
 * not a grantable role is dropped rather than refused: the form posts
 * checkboxes, and an unchecked box is simply absent.
 */
export async function setRtoCollectRoles(
  ctx: AuthContext,
  roles: readonly string[],
): Promise<readonly RtoCollectorRole[]> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may change who collects returns')
  const next = normaliseRtoRoles(roles)
  await connectDb()
  await AppSettings.updateOne(
    { _id: APP_SETTINGS_ID },
    { $set: { rtoCollectRoles: next } },
    { upsert: true },
  )
  return next
}
