/**
 * Creates every index explicitly. Plan §3: "create all of these explicitly,
 * do not rely on Mongoose autoIndex in production".
 *
 * Idempotent — safe to re-run. Run after any schema change:
 *   npm run indexes
 */
import type { CreateIndexesOptions, IndexDescription, IndexSpecification } from 'mongodb'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Order, Restaurant, User, Counter, TrainStatus, UnparsedInbox, Payment } from '../src/lib/models'

type Spec = { name: string; index: IndexDescription; why: string }

const ORDER_INDEXES: Spec[] = [
  {
    name: 'externalOrderId_unique',
    index: { key: { externalOrderId: 1 }, unique: true },
    why: 'idempotent ingestion — aggregator emails get resent',
  },
  {
    name: 'gmailMessageId_unique',
    // PARTIAL, not sparse. A sparse unique index still collides on repeated
    // explicit nulls; restricting to string values means manual orders (which
    // omit the field entirely) never participate in the index at all.
    index: {
      key: { gmailMessageId: 1 },
      unique: true,
      partialFilterExpression: { gmailMessageId: { $type: 'string' } },
    },
    why: 'idempotent ingestion — same Gmail message replayed by history sync',
  },
  {
    name: 'store_dashboard',
    index: { key: { restaurantId: 1, serviceDate: 1, status: 1 } },
    why: 'store manager dashboard: today, this outlet, by status',
  },
  {
    name: 'run_grouping',
    index: { key: { trainNo: 1, serviceDate: 1, stationCode: 1 } },
    why: 'grouping orders into a train run',
  },
  {
    name: 'admin_views',
    index: { key: { status: 1, serviceDate: 1 } },
    why: 'admin all-orders filters',
  },
  {
    name: 'agent_runs',
    index: { key: { 'delivery.agentIds': 1, serviceDate: 1 } },
    why: "a delivery agent's assigned runs for today",
  },
]

const RESTAURANT_INDEXES: Spec[] = [
  { name: 'stationCode', index: { key: { stationCode: 1 } }, why: 'outlets at a station' },
  { name: 'name', index: { key: { name: 1 } }, why: 'outlet lookup by name' },
  { name: 'aliases', index: { key: { aliases: 1 } }, why: 'email outlet-name alias matching (Phase 2)' },
]

const TRAIN_STATUS_INDEXES: Spec[] = [
  {
    name: 'train_station_day_unique',
    index: { key: { trainNo: 1, serviceDate: 1, stationCode: 1 }, unique: true },
    why: 'one cached reading per train per station per day — ten orders, one call',
  },
  {
    name: 'fetchedAt',
    index: { key: { fetchedAt: 1 } },
    why: 'pruning stale cache rows',
  },
]

const UNPARSED_INBOX_INDEXES: Spec[] = [
  {
    name: 'open_rows',
    index: { key: { resolved: 1, createdAt: -1 } },
    why: 'admin inbox: what still needs attention, newest first',
  },
  {
    name: 'gmailMessageId',
    index: {
      key: { gmailMessageId: 1 },
      partialFilterExpression: { gmailMessageId: { $type: 'string' } },
    },
    why: 'a replayed bad message must not pile up duplicate inbox rows',
  },
]

const PAYMENT_INDEXES: Spec[] = [
  {
    name: 'rrn_unique',
    index: { key: { rrn: 1 }, unique: true },
    why: 'idempotent ingestion — the bank replays the same credit alert',
  },
  {
    name: 'gmailMessageId_unique',
    // PARTIAL, not sparse — same reasoning as the order index above: a pasted
    // or backfilled payment omits the key entirely rather than storing a null
    // that would collide with the next one.
    index: {
      key: { gmailMessageId: 1 },
      unique: true,
      partialFilterExpression: { gmailMessageId: { $type: 'string' } },
    },
    why: 'idempotent ingestion — same Gmail message replayed by history sync',
  },
  {
    name: 'ledger',
    index: { key: { transactionDate: -1, receivedAt: -1 } },
    why: 'the payments page: newest first, filtered by date range',
  },
  {
    name: 'payer',
    index: { key: { payerName: 1 } },
    why: '"did this person ever pay" — the payer-name search',
  },
]

const USER_INDEXES: Spec[] = [
  { name: 'phone_unique', index: { key: { phone: 1 }, unique: true }, why: 'phone is the login identifier' },
  // Multikey on restaurantIds — one manager may hold several outlets.
  { name: 'role_restaurants', index: { key: { role: 1, restaurantIds: 1 } }, why: 'staff listing per outlet' },
]

type IndexCreator = {
  collection: {
    createIndex(key: IndexSpecification, options?: CreateIndexesOptions): Promise<string>
  }
}

async function ensure(collectionName: string, model: IndexCreator, specs: Spec[]) {
  console.log(`\n${collectionName}`)
  for (const spec of specs) {
    const { key, ...options } = spec.index
    const created = await model.collection.createIndex(key, { name: spec.name, ...options })
    console.log(`  ✓ ${created.padEnd(24)} ${JSON.stringify(key)}`)
    console.log(`    ${spec.why}`)
  }
}

async function main() {
  await connectDb()
  // Which database, stated up front. Both npm scripts load .env.local, which
  // is the dev database — running this against dev while believing it hit
  // production looks exactly like success, and the missing unique index is
  // then invisible until duplicate rows appear.
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)
  console.log('Creating indexes explicitly (autoIndex is disabled).')

  await ensure('orders', Order, ORDER_INDEXES)
  await ensure('restaurants', Restaurant, RESTAURANT_INDEXES)
  await ensure('users', User, USER_INDEXES)
  await ensure('trainstatuses', TrainStatus, TRAIN_STATUS_INDEXES)
  await ensure('unparsedinboxes', UnparsedInbox, UNPARSED_INBOX_INDEXES)
  await ensure('payments', Payment, PAYMENT_INDEXES)

  // Counter uses a natural string _id; the default _id index is all it needs.
  await Counter.collection.createIndex({ _id: 1 })

  console.log('\nAll indexes created.')
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nIndex creation FAILED:', err.message)
  process.exit(1)
})
