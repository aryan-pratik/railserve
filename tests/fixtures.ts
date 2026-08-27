import mongoose from 'mongoose'
import { connectDb } from '../src/lib/db'
import { Counter, Order, Restaurant, User } from '../src/lib/models'
import type { AuthContext } from '../src/lib/authContext'
import { insertOrder } from '../src/lib/repo/orderRepo'

export async function resetDb() {
  await connectDb()
  await Promise.all([
    Order.deleteMany({}),
    Restaurant.deleteMany({}),
    User.deleteMany({}),
    // Counters are deliberately monotonic in production — an order id must
    // never be reused after a deletion — so they survive deleteMany on orders
    // and have to be cleared explicitly for a test to see a fresh sequence.
    Counter.deleteMany({}),
  ])
  // The tests exercise the unique/partial indexes, so they must exist.
  await Order.collection.createIndex({ externalOrderId: 1 }, { unique: true, name: 'externalOrderId_unique' })
  await Order.collection.createIndex(
    { gmailMessageId: 1 },
    { unique: true, name: 'gmailMessageId_unique', partialFilterExpression: { gmailMessageId: { $type: 'string' } } },
  )
}

export async function makeRestaurant(name: string, stationCode: string) {
  return Restaurant.create({ name, stationCode, stationName: name, walkToPlatformMinutes: 10 })
}

export async function makeUser(
  role: AuthContext['role'],
  phone: string,
  restaurantId: mongoose.Types.ObjectId | null = null,
) {
  return User.create({ name: `${role} ${phone}`, phone, passwordHash: 'x', role, restaurantId })
}

export function ctxFor(user: {
  _id: mongoose.Types.ObjectId
  role: string
  restaurantId?: mongoose.Types.ObjectId | null
}): AuthContext {
  return {
    userId: user._id,
    role: user.role as AuthContext['role'],
    restaurantId: user.restaurantId ?? null,
  }
}

let seq = 0

export async function makeOrder(overrides: Record<string, unknown> = {}) {
  seq += 1
  return insertOrder({
    source: 'MANUAL',
    orderType: 'RETAIL',
    externalOrderId: `TEST-${Date.now()}-${seq}`,
    status: 'RECEIVED',
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
