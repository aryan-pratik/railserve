import mongoose from 'mongoose'
import { connectDb } from '../db'
import { env } from '../env'
import { ensureIndexes } from '../indexes'
import { Tenant } from '../models/Tenant'
import { setFallbackTenantId } from './plugin'
import { forgetPrimaryTenant } from './primary'

/** Collections whose documents belong to one tenant. */
export const TENANT_COLLECTIONS = [
  'orders',
  'restaurants',
  'listings',
  'users',
  'menuitems',
  'printjobs',
  'payments',
  'unparsedinboxes',
  'riderlocations',
  'waconversations',
  'wamessages',
  'counters',
  'ingeststates',
  'stations',
  'mailsources',
  'cashhandins',
  'tenantfiles',
  'mailboxes',
] as const

let done: Promise<void> | null = null

/**
 * Brings a database up to the tenancy schema. Runs once per process, at boot
 * (src/instrumentation.ts), before the server takes requests.
 *
 * Idempotent and additive, so it is safe on every boot and an older image
 * still runs on the result after a rollback:
 *   1. make sure the primary tenant exists;
 *   2. stamp every document that has no tenantId with the primary tenant;
 *   3. create every index (old global ones kept, tenant-leading ones added).
 */
export function ensureTenancy(log: (line: string) => void = () => {}): Promise<void> {
  if (!done) {
    done = run(log).catch((err) => {
      done = null
      throw err
    })
  }
  return done
}

async function run(log: (line: string) => void): Promise<void> {
  await connectDb()
  const db = mongoose.connection.db
  if (!db) throw new Error('ensureTenancy: not connected')

  let primary = await Tenant.findOne({ primary: true }).lean()
  if (!primary) {
    const created = await Tenant.create({
      name: env.PRIMARY_TENANT_NAME,
      slug: 'primary',
      primary: true,
      status: 'ACTIVE',
    })
    primary = created.toObject()
    log(`created primary tenant ${primary._id} (${primary.name})`)
  }
  forgetPrimaryTenant()
  setFallbackTenantId(primary._id)

  for (const name of TENANT_COLLECTIONS) {
    const res = await db.collection(name).updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: primary._id } })
    if (res.modifiedCount) log(`${name}: ${res.modifiedCount} document(s) assigned to the primary tenant`)
  }

  const tenants = await Tenant.countDocuments({})
  const failed = await ensureIndexes({ multiTenant: tenants > 1 })
  if (failed.length) log(`indexes not built (see errors above): ${failed.join(', ')}`)
  log('tenancy ready')
}
