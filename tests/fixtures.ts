import mongoose from 'mongoose'
import { connectDb } from '../src/lib/db'
import { Order, Restaurant, Station, Tenant, User } from '../src/lib/models'
import { ensureIndexes } from '../src/lib/indexes'
import { TENANT_COLLECTIONS } from '../src/lib/tenancy/bootstrap'
import { setFallbackTenantId } from '../src/lib/tenancy/plugin'
import { forgetPrimaryTenant, tenantKey } from '../src/lib/tenancy/primary'
import type { AuthContext } from '../src/lib/authContext'
import { insertOrder } from '../src/lib/repo/orderRepo'

/**
 * Every fixture belongs to a tenant. resetDb() makes a fresh primary tenant
 * and makes it current; makeTenant() adds another, and switchTenant() switches
 * which one the make* helpers write into, for two-tenant isolation tests.
 */
let currentTenantId: mongoose.Types.ObjectId | null = null

export function tenantId(): mongoose.Types.ObjectId {
  if (!currentTenantId) throw new Error('No test tenant: call resetDb() first.')
  return currentTenantId
}

export function switchTenant(id: mongoose.Types.ObjectId): void {
  currentTenantId = id
}

export async function makeTenant(name: string, opts: { primary?: boolean } = {}) {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new mongoose.Types.ObjectId().toHexString().slice(-6)}`
  return Tenant.create({ name, slug, primary: opts.primary ?? false, status: 'ACTIVE' })
}

export async function resetDb() {
  await connectDb()
  const db = mongoose.connection.db!
  // Raw collection calls: the reset is platform-level and deliberately
  // crosses every tenant. Counters included: they are monotonic in production
  // and must be cleared for a test to see a fresh sequence.
  await Promise.all(
    [...TENANT_COLLECTIONS, 'tenants'].map((name) => db.collection(name).deleteMany({})),
  )
  forgetPrimaryTenant()
  const primary = await makeTenant('Test Primary', { primary: true })
  currentTenantId = primary._id
  setFallbackTenantId(primary._id)
  // Every index the app has, in multi-tenant form: the tests exercise the
  // unique and partial ones, and some create a second tenant.
  await ensureIndexes({ multiTenant: true })
}

export async function makeRestaurant(name: string, stationCode: string, aliases: string[] = []) {
  return Restaurant.create({
    tenantId: tenantId(), name, stationCode, stationName: name, aliases, walkToPlatformMinutes: 10,
  })
}

export async function makeStation(
  code: string,
  opts: {
    name?: string
    printAgentToken?: string
    /** Set it and the station leaves the agent path for direct printing. */
    directPrinterHost?: string
    directPrinterPort?: number
  } = {},
) {
  return Station.create({
    _id: await tenantKey(tenantId(), code),
    tenantId: tenantId(),
    name: opts.name ?? `${code} Junction`,
    printAgentToken: opts.printAgentToken ?? null,
    directPrinterHost: opts.directPrinterHost ?? null,
    ...(opts.directPrinterPort === undefined ? {} : { directPrinterPort: opts.directPrinterPort }),
  })
}

/** Accepts one outlet or several — a store manager may hold many. */
export async function makeUser(
  role: AuthContext['role'],
  phone: string,
  outlets: mongoose.Types.ObjectId | mongoose.Types.ObjectId[] | null = null,
) {
  const restaurantIds = outlets === null ? [] : Array.isArray(outlets) ? outlets : [outlets]
  return User.create({ tenantId: tenantId(), name: `${role} ${phone}`, phone, passwordHash: 'x', role, restaurantIds })
}

export function ctxFor(user: {
  _id: mongoose.Types.ObjectId
  role: string
  restaurantIds?: mongoose.Types.ObjectId[] | null
  tenantId?: mongoose.Types.ObjectId | null
}): AuthContext {
  return {
    tenantId: user.tenantId ?? tenantId(),
    userId: user._id,
    role: user.role as AuthContext['role'],
    restaurantIds: user.restaurantIds ?? [],
  }
}

let seq = 0

export async function makeOrder(overrides: Record<string, unknown> = {}) {
  seq += 1
  return insertOrder({
    tenantId: tenantId(),
    source: 'MANUAL',
    orderType: 'RETAIL',
    externalOrderId: `TEST-${Date.now()}-${seq}`,
    status: 'RECEIVED',
    // Birth event, exactly as createManualOrder and the ingest pipeline write
    // one. Without it a fixture order has no RECEIVED timestamp, and anything
    // measuring from "when did this arrive" — outletAnalytics' received-to-
    // delivered duration, for one — silently reads null.
    events: [
      {
        fromStatus: null,
        toStatus: 'RECEIVED',
        userId: null,
        meta: { action: 'CREATED', source: 'TEST' },
        createdAt: new Date(),
      },
    ],
    stationCode: 'CNB',
    serviceDate: '2026-08-27',
    timingSource: 'SCHEDULED',
    items: [{ name: 'Veg Thali', qty: 1, pricePaise: 12000 }],
    amountPaise: 12000,
    paymentMode: 'COD',
    contactName: 'Test Passenger',
    contactPhone: '9000000099',
    ...overrides,
  })
}

/**
 * Gives an order to a rider, as a telecaller, store manager or admin would.
 * A rider sees only what is assigned to them, so any test that has a rider
 * act on an order assigns it first.
 */
export async function assignRider(
  orderId: string | mongoose.Types.ObjectId,
  riderId: mongoose.Types.ObjectId,
) {
  // assignedAt too, as assignRiders writes it: it is what marks the order as
  // the office's choice rather than one a rider took off the counter.
  await Order.updateOne(
    { _id: orderId, tenantId: tenantId() },
    { $addToSet: { 'delivery.agentIds': riderId }, $set: { 'delivery.assignedAt': new Date() } },
  )
}
