/**
 * Runs once per server process, before it takes requests (Next.js
 * instrumentation `register`). Brings the database up to the tenancy schema:
 * see src/lib/tenancy/bootstrap.ts. A failure here stops the server from
 * starting, which in production makes the deploy health check fail and roll
 * back, rather than serving requests on a half-migrated database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { ensureTenancy } = await import('./lib/tenancy/bootstrap')
  await ensureTenancy((line) => console.log(`[tenancy] ${line}`))
  // Orders still in a status that no longer exists get their real status.
  // A no-op once done; see lib/repo/statusCleanup.ts.
  const { cleanUpRetiredStatuses } = await import('./lib/repo/statusCleanup')
  await cleanUpRetiredStatuses((line) => console.log(`[statuses] ${line}`))
}
