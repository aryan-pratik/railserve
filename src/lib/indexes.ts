/**
 * Every index the app relies on, created explicitly at boot by
 * ensureTenancy() (src/instrumentation.ts) and by `npm run indexes`.
 * Plan §3: "create all of these explicitly, do not rely on Mongoose autoIndex".
 *
 * createIndex is idempotent, so running this on every boot costs a round trip
 * per index and fixes the old "hope someone ran the script" gap.
 *
 * The *_INDEXES lists are the single-tenant set from v1 and are left in place
 * so an older image keeps working after a rollback. TENANT_INDEXES adds the
 * tenant-leading versions; the old global unique keys are dropped only once
 * a second tenant exists and v1 images are gone.
 */
import type { IndexDescription } from 'mongodb'
import mongoose from 'mongoose'
import {
  Order,
  Restaurant,
  User,
  TrainStatus,
  UnparsedInbox,
  Payment,
  PrintJob,
  Station,
  RiderLocation,
  Listing,
  WaConversation,
  WaMessage,
} from './models'

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
  {
    name: 'rider_record',
    index: { key: { 'delivery.pickedUpBy': 1, 'delivery.closedAt': -1 } },
    why: "the rider ledger: what one rider carried, by when it closed (app history and the admin riders board)",
  },
  {
    name: 'rto_pending',
    // Partial: almost no order ever has a return, so the index holds only the
    // handful that do, and the returns list and nav badge never scan.
    index: {
      key: { 'delivery.rto.status': 1, restaurantId: 1, 'delivery.rto.openedAt': 1 },
      partialFilterExpression: { 'delivery.rto.status': { $exists: true } },
    },
    why: 'the returns list and its badge: bags still out with a rider, per outlet',
  },
  {
    name: 'activity_events',
    index: { key: { 'events.createdAt': -1 } },
    why: 'the admin activity log: every order event in a date range',
  },
  {
    name: 'activity_actor',
    index: { key: { 'events.userId': 1, 'events.createdAt': -1 } },
    why: "the activity log filtered to one person, and a rider's own event log",
  },
  {
    name: 'activity_notes',
    index: { key: { 'callLog.createdAt': -1 } },
    why: 'call notes in the activity log',
  },
]

const RESTAURANT_INDEXES: Spec[] = [
  { name: 'stationCode', index: { key: { stationCode: 1 } }, why: 'outlets at a station' },
  { name: 'name', index: { key: { name: 1 } }, why: 'outlet lookup by name' },
  { name: 'aliases', index: { key: { aliases: 1 } }, why: 'email outlet-name alias matching (Phase 2)' },
]

const STATION_INDEXES: Spec[] = [
  {
    name: 'printAgentToken_unique',
    // Partial, not sparse — same reasoning as the order and payment indexes
    // above: a station with no agent yet stores an explicit null, and a
    // sparse unique index still collides on repeated nulls.
    index: {
      key: { printAgentToken: 1 },
      unique: true,
      partialFilterExpression: { printAgentToken: { $type: 'string' } },
    },
    why: 'the print agent authenticates on this on every poll, forever',
  },
]

const PRINT_JOB_INDEXES: Spec[] = [
  {
    name: 'agent_claim',
    index: { key: { stationCode: 1, status: 1, createdAt: 1 } },
    why: "the claim query, run every few seconds forever: this station's oldest pending job. Unindexed before — a collection scan across documents holding PNGs",
  },
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
    name: 'open_rows_by_reason',
    index: { key: { resolved: 1, reason: 1, createdAt: -1 } },
    why: 'admin inbox: the reason filter and its counts, at hundreds of open rows',
  },
  {
    name: 'bulk_action',
    index: {
      key: { bulkActionId: 1 },
      partialFilterExpression: { bulkActionId: { $type: 'string' } },
    },
    why: 'undoing one bulk dismiss reopens exactly that batch',
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

const LISTING_INDEXES: Spec[] = [
  {
    name: 'name_station',
    index: { key: { name: 1, stationCode: 1 } },
    why: 'every ingested mail resolves its storefront name through this',
  },
  {
    name: 'aliases',
    index: { key: { aliases: 1 } },
    why: 'an aggregator renaming a storefront becomes an alias, matched the same way',
  },
  {
    name: 'outlet',
    index: { key: { restaurantId: 1 } },
    why: 'the Setup screen lists the storefronts feeding each outlet',
  },
]

const RIDER_LOCATION_INDEXES: Spec[] = [
  {
    name: 'userId_unique',
    // Unique, not merely indexed. This collection holds one row per rider that
    // is upserted forever; a duplicate would split a rider in two and put the
    // same person on the map twice, in two different places.
    index: { key: { userId: 1 }, unique: true },
    why: 'one live position per rider — the upsert target, and the board\'s lookup',
  },
]


const WA_CONVERSATION_INDEXES: Spec[] = [
  {
    name: 'phone_unique',
    index: { key: { phone: 1 }, unique: true },
    why: 'one WhatsApp thread per passenger number; the webhook upserts on it',
  },
  {
    name: 'chat_list',
    index: { key: { restaurantId: 1, lastMessageAt: -1 } },
    why: "the telecaller's conversation list: this outlet, newest first",
  },
  {
    name: 'chat_assigned',
    index: { key: { assignedTo: 1, lastMessageAt: -1 } },
    why: 'the "Mine" filter on the conversation list',
  },
  {
    name: 'chat_version',
    index: { key: { updatedAt: -1 } },
    why: 'the live feed reads the newest change in scope every few seconds',
  },
]

const WA_MESSAGE_INDEXES: Spec[] = [
  {
    name: 'thread',
    index: { key: { conversationId: 1, createdAt: -1 } },
    why: 'one thread, newest page of messages',
  },
  {
    name: 'providerMessageId_unique',
    // PARTIAL, as gmailMessageId is: a queued message has no wamid yet and
    // omits the key, so only real provider ids take part.
    index: {
      key: { providerMessageId: 1 },
      unique: true,
      partialFilterExpression: { providerMessageId: { $type: 'string' } },
    },
    why: 'idempotent webhook: a replayed inbound message is a no-op, and a status report finds its message',
  },
  {
    name: 'providerRequestId',
    index: { key: { providerRequestId: 1 } },
    why: 'MSG91 status reports arrive by request id before the wamid is known',
  },
]

const TENANT_INDEXES: Record<string, Spec[]> = {
  orders: [
    { name: 'tenant_externalOrderId_unique', index: { key: { tenantId: 1, externalOrderId: 1 }, unique: true }, why: 'order number is unique per tenant' },
    { name: 'tenant_restaurant_day_status', index: { key: { tenantId: 1, restaurantId: 1, serviceDate: 1, status: 1 } }, why: 'kitchen board per outlet and day' },
    { name: 'tenant_status_day', index: { key: { tenantId: 1, status: 1, serviceDate: 1 } }, why: 'admin board by status and day' },
    { name: 'tenant_day', index: { key: { tenantId: 1, serviceDate: 1 } }, why: 'day views and analytics' },
  ],
  restaurants: [{ name: 'tenant_name', index: { key: { tenantId: 1, name: 1 } }, why: 'outlets of a tenant' }],
  users: [{ name: 'tenant_role_restaurants', index: { key: { tenantId: 1, role: 1, restaurantIds: 1 } }, why: 'staff listing per tenant' }],
  payments: [
    { name: 'tenant_rrn_unique', index: { key: { tenantId: 1, rrn: 1 }, unique: true }, why: 'a bank reference is unique per tenant' },
    { name: 'tenant_txdate', index: { key: { tenantId: 1, transactionDate: -1 } }, why: 'payments list' },
  ],
  unparsedinboxes: [{ name: 'tenant_resolved_created', index: { key: { tenantId: 1, resolved: 1, createdAt: -1 } }, why: 'inbox queue' }],
  printjobs: [{ name: 'tenant_station_status', index: { key: { tenantId: 1, stationCode: 1, status: 1, createdAt: 1 } }, why: 'print agent queue' }],
  waconversations: [
    { name: 'tenant_lastMessage', index: { key: { tenantId: 1, lastMessageAt: -1 } }, why: 'chat list' },
    { name: 'tenant_phone_unique', index: { key: { tenantId: 1, phone: 1 }, unique: true }, why: 'one thread per passenger number, per tenant' },
  ],
  wamessages: [{ name: 'tenant_conversation_created', index: { key: { tenantId: 1, conversationId: 1, createdAt: -1 } }, why: 'chat thread' }],
  listings: [{ name: 'tenant', index: { key: { tenantId: 1 } }, why: 'tenant scope' }],
  menuitems: [{ name: 'tenant_source', index: { key: { tenantId: 1, source: 1 } }, why: 'menu per tenant' }],
  stations: [{ name: 'tenant', index: { key: { tenantId: 1 } }, why: 'tenant scope' }],
  riderlocations: [{ name: 'tenant', index: { key: { tenantId: 1 } }, why: 'tenant scope' }],
  counters: [{ name: 'tenant', index: { key: { tenantId: 1 } }, why: 'tenant scope' }],
  ingeststates: [{ name: 'tenant', index: { key: { tenantId: 1 } }, why: 'tenant scope' }],
  mailsources: [{ name: 'tenant_key_unique', index: { key: { tenantId: 1, key: 1 }, unique: true }, why: 'one row per mail source, per tenant' }],
  tenants: [{ name: 'slug_unique', index: { key: { slug: 1 }, unique: true }, why: 'tenant handle' }],
}

const LEGACY: [string, Spec[]][] = [
  ['orders', ORDER_INDEXES],
  ['restaurants', RESTAURANT_INDEXES],
  ['users', USER_INDEXES],
  ['trainstatuses', TRAIN_STATUS_INDEXES],
  ['unparsedinboxes', UNPARSED_INBOX_INDEXES],
  ['payments', PAYMENT_INDEXES],
  ['printjobs', PRINT_JOB_INDEXES],
  ['stations', STATION_INDEXES],
  ['riderlocations', RIDER_LOCATION_INDEXES],
  ['listings', LISTING_INDEXES],
  ['waconversations', WA_CONVERSATION_INDEXES],
  ['wamessages', WA_MESSAGE_INDEXES],
]

// Keep the model imports referenced: they register the schemas, and the
// collection names below are theirs.
void [Order, Restaurant, User, TrainStatus, UnparsedInbox, Payment, PrintJob, Station, RiderLocation, Listing, WaConversation, WaMessage]

/**
 * Legacy unique keys that are global, and so wrong once a second tenant exists:
 * two tenants both issue MAN-20261121-001, and the same passenger can message
 * two operators. While only the primary tenant exists they stay, because a
 * rolled-back pre-tenancy image depends on them. Others stay global on purpose:
 * phone (login is by phone across the platform), print tokens, provider ids.
 */
const GLOBAL_UNIQUE_DROPPED_FOR_MULTI_TENANT: [string, string][] = [
  ['orders', 'externalOrderId_unique'],
  ['payments', 'rrn_unique'],
  ['waconversations', 'phone_unique'],
]

/**
 * Creates every index and returns the names of any that could not be built.
 * Idempotent. With `multiTenant`, the legacy global
 * unique keys above are dropped and not recreated (their tenant-leading
 * replacements are in TENANT_INDEXES).
 */
export async function ensureIndexes(
  opts: { multiTenant?: boolean; log?: (line: string) => void } = {},
): Promise<string[]> {
  const log = opts.log ?? (() => {})
  const db = mongoose.connection.db
  if (!db) throw new Error('ensureIndexes: not connected')
  const skip = new Set(opts.multiTenant ? GLOBAL_UNIQUE_DROPPED_FOR_MULTI_TENANT.map(([c, n]) => `${c}.${n}`) : [])

  if (opts.multiTenant) {
    for (const [collection, name] of GLOBAL_UNIQUE_DROPPED_FOR_MULTI_TENANT) {
      const existing = await db.collection(collection).indexes().catch(() => [])
      if (existing.some((i) => i.name === name)) {
        await db.collection(collection).dropIndex(name)
        log(`${collection}.${name} dropped (global unique, replaced per tenant)`)
      }
    }
  }

  const all: [string, Spec[]][] = [...LEGACY, ...Object.entries(TENANT_INDEXES)]
  const failed: string[] = []
  for (const [collection, specs] of all) {
    for (const spec of specs) {
      if (skip.has(`${collection}.${spec.name}`)) continue
      const { key, ...options } = spec.index
      try {
        const created = await db.collection(collection).createIndex(key, { name: spec.name, ...options })
        log(`${collection}.${created}`)
      } catch (err) {
        // One bad index must not stop the server booting: existing data can
        // break a unique key (duplicates from before it was enforced), or an
        // index of that name may exist with other options. Reported loudly,
        // and the rest still get built.
        const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
        failed.push(`${collection}.${spec.name}`)
        console.error(`[indexes] could not create ${collection}.${spec.name}: ${msg}`)
      }
    }
  }
  return failed
}
