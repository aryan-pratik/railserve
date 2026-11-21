/**
 * Setup for dev and demo scripts: brings the database up to the tenancy
 * schema (as the server does at boot) and returns the primary tenant, which
 * is the tenant every seed and demo script writes into.
 *
 * Scripts run with the tenant guard in `log` mode unless told otherwise: a
 * seed that forgets a tenantId on a write is put on the primary tenant and
 * logged, rather than aborting half-way through a demo dataset.
 */
import type { Types } from 'mongoose'
import { ensureTenancy } from '../src/lib/tenancy/bootstrap'
import { getPrimaryTenantId } from '../src/lib/tenancy/primary'

export async function scriptTenant(): Promise<Types.ObjectId> {
  process.env.TENANT_GUARD ??= 'log'
  await ensureTenancy((line) => console.log(`[tenancy] ${line}`))
  return getPrimaryTenantId()
}
