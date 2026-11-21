import { Schema, type Query, type Aggregate, type PipelineStage } from 'mongoose'

/**
 * The structural tenant guard (plan §4).
 *
 * Applied to every tenant-owned schema. It adds `tenantId`, and it refuses any
 * query, aggregate or save that does not say which tenant it is for. A query
 * that forgets the tenant is exactly the bug that leaks one customer's orders
 * to another, so it must fail where it is written, not be found in an audit.
 *
 * The only way past the guard is to say so: `.setOptions({ allTenants: true })`
 * on a query, or `{ allTenants: true }` as an aggregate option. That is for
 * platform code (migrations, the super admin console, cron fan-out) and should
 * be rare enough to grep for.
 *
 * Mode (TENANT_GUARD): `throw` makes a violation an error; `log` logs it and
 * puts a tenantless write on the primary tenant. Unset, production logs and
 * everything else (dev, tests, CI) throws. Raw `Model.collection.*` calls and `bulkWrite` skip Mongoose
 * middleware entirely, so they are banned outside the tenancy module by lint.
 */

export class TenantGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantGuardError'
  }
}

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct',
] as const

/** The guard's current mode; see the header comment. */
export function tenantGuardMode(): 'throw' | 'log' {
  return mode()
}

function mode(): 'throw' | 'log' {
  const set = process.env.TENANT_GUARD
  if (set === 'log' || set === 'throw') return set
  return process.env.NODE_ENV === 'production' ? 'log' : 'throw'
}

const logged = new Set<string>()

function violation(what: string): void {
  const message = `Tenant guard: ${what} has no tenantId. Scope it with ctx.tenantId, or setOptions({ allTenants: true }) for platform code.`
  if (mode() === 'throw') throw new TenantGuardError(message)
  const site = (new Error().stack ?? '').split('\n').slice(3, 6).join(' | ')
  const key = `${what} @ ${site}`
  if (logged.has(key)) return
  logged.add(key)
  console.error(`[tenant-guard] ${message}\n  at ${site}`)
}

/** A concrete tenant: an id, or `{ $eq: id }`. `$in` and `$exists` do not count. */
function namesOneTenant(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>
    if ('$eq' in v) return v.$eq != null
    // An ObjectId is an object with a toHexString; an operator object is not.
    return typeof (v as { toHexString?: unknown }).toHexString === 'function'
  }
  return typeof value === 'string' && value.length > 0
}

function filterHasTenant(filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return false
  if (namesOneTenant(filter.tenantId)) return true
  // { $and: [{ tenantId }, ...] } is fine too.
  const and = filter.$and
  if (Array.isArray(and)) return and.some((part) => filterHasTenant(part as Record<string, unknown>))
  return false
}

export function tenantScoped(schema: Schema): void {
  if (!schema.path('tenantId')) {
    schema.add({ tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true } })
  }

  for (const op of QUERY_OPS) {
    schema.pre(op, function (this: Query<unknown, unknown>) {
      if (this.getOptions()?.allTenants) return
      if (!filterHasTenant(this.getFilter())) violation(`${this.model.modelName}.${op}`)
    })
  }

  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    if ((this.options as { allTenants?: boolean } | undefined)?.allTenants) return
    const first = this.pipeline()[0] as PipelineStage | undefined
    const match = first && '$match' in first ? (first.$match as Record<string, unknown>) : undefined
    if (!filterHasTenant(match)) {
      violation(`${(this as unknown as { _model?: { modelName?: string } })._model?.modelName ?? 'Model'}.aggregate (first stage must $match tenantId)`)
    }
  })

  schema.pre('insertMany', function (next: (err?: Error) => void, docs: unknown) {
    const list = (Array.isArray(docs) ? docs : [docs]) as { tenantId?: unknown }[]
    if (list.some((d) => !namesOneTenant(d?.tenantId))) {
      try {
        violation(`${(this as unknown as { modelName?: string }).modelName ?? 'Model'}.insertMany`)
      } catch (err) {
        return next(err as Error)
      }
    }
    next()
  })

  // In log mode (production rollout) a write that forgot its tenant is put on
  // the primary tenant rather than failing validation, and logged. In throw
  // mode the required validator rejects it.
  schema.pre('validate', function (this: { tenantId?: unknown }) {
    if (this.tenantId != null || mode() !== 'log') return
    const fallback = fallbackTenantId()
    violation('save')
    if (fallback) this.tenantId = fallback
  })

  schema.index({ tenantId: 1 })
}

let primaryForFallback: unknown = null
/** Set once by ensureTenancy(); used only by the log-mode save fallback. */
export function setFallbackTenantId(id: unknown): void {
  primaryForFallback = id
}
function fallbackTenantId(): unknown {
  return primaryForFallback
}
