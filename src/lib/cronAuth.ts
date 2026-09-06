import { env } from './env'

/**
 * Shared token check for the /api/cron/* endpoints.
 *
 * Three endpoints had grown their own byte-identical copy of this. They are
 * the only routes that authenticate something other than a signed-in user, so
 * the one place that decides what counts as a valid scheduler is worth having.
 *
 * Returns null when the caller is authorised, or the reason it is not.
 */
export function cronAuthFailure(request: Request): string | null {
  const expected = env.CRON_TOKEN
  // Blank leaves the endpoint open, which is fine locally and is not fine on
  // a public host — see docs/VERCEL.md.
  if (!expected) return null

  const url = new URL(request.url)
  const supplied =
    request.headers.get('x-cron-token') ??
    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; accept that
    // shape too so the same endpoint works from their scheduler unchanged.
    request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
    url.searchParams.get('token') ??
    ''

  return supplied === expected ? null : 'Unauthorized'
}
