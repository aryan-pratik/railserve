import { Types } from 'mongoose'
import { Tenant } from '../models/Tenant'

/**
 * The primary tenant: our own operation, tenant #1. It owns the integrations
 * that are still configured by environment variables (the Gmail mailbox, the
 * MSG91 number, the train-status key), so webhooks and cron jobs for those
 * act on it.
 */
let cached: Promise<Types.ObjectId> | null = null

export function getPrimaryTenantId(): Promise<Types.ObjectId> {
  if (!cached) {
    cached = Tenant.findOne({ primary: true })
      .select('_id')
      .lean()
      .then((t) => {
        if (!t) {
          cached = null
          throw new Error('No primary tenant. ensureTenancy() has not run on this database.')
        }
        return t._id as Types.ObjectId
      })
      .catch((err) => {
        cached = null
        throw err
      })
  }
  return cached
}

/** For tests that reset the database between files. */
export function forgetPrimaryTenant(): void {
  cached = null
}

/**
 * Key for documents whose _id is a natural string (Counter, MenuItem,
 * Station, IngestState). The primary tenant keeps the bare legacy key, so a
 * rollback to a pre-tenancy image still finds its counters and stations;
 * every other tenant's key is prefixed with its id.
 */
export async function tenantKey(tenantId: Types.ObjectId | string, key: string): Promise<string> {
  const primary = await getPrimaryTenantId()
  // Upper-case hex: Station ids are stored upper-cased by their schema, and
  // one form everywhere keeps naturalKey() and lookups agreeing.
  return primary.equals(tenantId) ? key : `${String(tenantId).toUpperCase()}:${key}`
}

/** The reverse of tenantKey: the natural key with any tenant prefix removed. */
export function naturalKey(id: string): string {
  const i = id.indexOf(':')
  return i === 24 && /^[0-9a-f]{24}$/i.test(id.slice(0, 24)) ? id.slice(25) : id
}
