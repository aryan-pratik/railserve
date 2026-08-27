# Train Food Delivery — Order Tracking System

Build plan / handoff spec. **Database: MongoDB.**

---

## 1. What this is

A food ordering operations system for train passengers. Orders arrive from two places, get cooked at partner restaurant outlets near railway stations, and get delivered to a passenger's seat (or a bulk handover point) while the train is halted at the station.

**Two order inlets:**

1. **Retail** — aggregators (YatriRestro, DailyYatri) email structured order confirmations to a shared Gmail inbox. Parsed automatically.
2. **Bulk** — enquiries arrive on the admin's WhatsApp as semi-structured text. Admin pastes them into the panel, completes missing fields, quotes, and confirms.

Both converge into one order pipeline from that point on.

**Three surfaces:**

- Admin web console
- Store manager web dashboard
- Delivery agent mobile app

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend + web | Next.js (App Router), TypeScript | API routes for the backend; no separate service |
| Database | MongoDB 6+ (Atlas) | **Must be a replica set** — transactions require it |
| ODM | Mongoose | Not Prisma; its Mongo support lacks features used here |
| Auth | Auth.js (NextAuth) with credentials + JWT | Roles in the token |
| Realtime (web) | Server-Sent Events | Simpler than WebSockets, auto-reconnects |
| Push (mobile) | Firebase Cloud Messaging | Required — the delivery app will be backgrounded |
| Jobs / scheduling | BullMQ + Redis | Train polling, Gmail watch renewal |
| Mobile | React Native (Expo) | |
| Styling | Tailwind | |

### What Mongo gives you here

Order items, status events, and the delivery record are all owned by exactly one order and never queried independently. Embed them in the order document. One read gets the whole order — no joins on the hot path, and the store dashboard and delivery app both get simpler. Raw email bodies and pasted WhatsApp text are also a natural fit as free-form subdocuments.

### What you must compensate for

Two safety nets that a relational database would have given you for free. Build both in Phase 1 — retrofitting them later is painful.

**1. Store isolation has no database-level enforcement.** There is no row-level security. A store manager seeing another outlet's orders is now purely a discipline problem in application code. Mitigate with a hard rule:

- All order reads go through `orderRepo.scoped(ctx)`, which returns a Mongoose `Query` pre-filtered by `ctx.restaurantId` when `ctx.role === 'STORE_MANAGER'`.
- `Order.find()`, `Order.findOne()`, and `Order.aggregate()` are **never** called directly outside `lib/repo/orderRepo.ts`.
- Enforce with an ESLint `no-restricted-syntax` rule that fails the build on direct model access elsewhere.
- Write an integration test that logs in as store manager A and asserts a 404 on an order belonging to store B, by ID.

**2. Referential integrity is not enforced.** Nothing stops an order pointing at a deleted restaurant or a `userId` that doesn't exist. Mitigate:

- Never hard-delete restaurants or users. Set `active: false`. Add this as a rule, not a convention.
- Validate `restaurantId` exists before order creation, in the service layer.
- Never embed restaurant or user data inside order documents — store the ObjectId reference and populate. Denormalised names go stale the first time an outlet is renamed.

### Conventions

- All timestamps stored UTC, displayed Asia/Kolkata. Never store a naive local time.
- Money in paise (integer). No floats, no `Decimal128` needed.
- Every status change goes through a single `transitionOrder()` function, wrapped in a Mongo transaction, that updates `status` and pushes an event onto the embedded `events` array atomically. No direct status writes anywhere else.
- Every external identifier gets a unique index. Emails get resent; the system must be idempotent.
- `strict: true` on every schema. Mongoose silently drops unknown fields otherwise, which turns a typo into a missing order field with no error.

---

## 3. Data model

Three collections: `restaurants`, `users`, `orders`. Plus two operational ones: `trainstatuses`, `unparsedinbox`.

```ts
// restaurants
{
  _id: ObjectId,
  name: String,                    // required
  stationCode: String,             // required, e.g. "CNB"
  stationName: String,
  aliases: [String],               // outlet name variants seen in emails
  contactName: String,
  contactPhone: String,
  walkToPlatformMinutes: Number,   // default 10
  active: { type: Boolean, default: true }
}
// index: { stationCode: 1 }, { name: 1 }, { aliases: 1 }
```

```ts
// users
{
  _id: ObjectId,
  name: String,
  phone: String,                   // unique
  passwordHash: String,
  role: 'ADMIN' | 'STORE_MANAGER' | 'DELIVERY_AGENT',
  restaurantId: ObjectId | null,   // null for ADMIN and DELIVERY_AGENT
  fcmToken: String | null,
  active: { type: Boolean, default: true }
}
// index: { phone: 1 } unique, { role: 1, restaurantId: 1 }
```

```ts
// orders — items, events and delivery are embedded
{
  _id: ObjectId,

  source: 'YATRIRESTRO' | 'DAILYYATRI' | 'MANUAL',
  orderType: 'RETAIL' | 'BULK',
  externalOrderId: String,         // unique
  status: OrderStatus,             // see section 4

  restaurantId: ObjectId | null,   // null while ENQUIRY
  stationCode: String,

  trainNo: String | null,          // nullable — bulk enquiries often lack it
  trainName: String | null,
  serviceDate: String,             // 'YYYY-MM-DD' in IST. String, not Date —
                                   // avoids timezone drift on a date-only field
  scheduledArrival: Date | null,
  timingSource: 'LIVE' | 'SCHEDULED',

  coach: String | null,
  berth: String | null,
  rawSeat: String | null,          // original unparsed seat string
  handoverPoint: String | null,    // bulk: "coach B5 door, contact Mr Sharma"

  contactName: String | null,
  contactPhone: String | null,

  pax: Number | null,              // bulk only
  amountPaise: Number | null,
  paymentMode: 'PREPAID' | 'COD' | 'INVOICE' | null,

  readyBy: Date | null,            // mandatory for bulk at confirmation
  notes: String | null,

  items: [{
    _id: ObjectId,
    name: String,
    qty: Number,
    pricePaise: Number | null,
    spec: String | null,           // full composite menu text for bulk thalis
    isPacking: { type: Boolean, default: false },  // tissue, spoon, water
    notes: String | null
  }],

  events: [{
    _id: ObjectId,
    fromStatus: String | null,
    toStatus: String,
    userId: ObjectId | null,
    meta: Object,
    createdAt: Date
  }],

  delivery: {
    runId: String | null,          // groups orders on the same train run
    agentIds: [ObjectId],          // array — bulk needs multiple agents
    assignedAt: Date | null,
    dispatchedAt: Date | null,
    deliveredAt: Date | null,
    proofType: 'OTP' | 'PHOTO' | 'SIGNATURE' | null,
    proofValue: String | null,
    amountCollectedPaise: Number | null,
    failureReason: String | null
  },

  rawPayload: Object,              // email body or pasted WhatsApp text
  gmailMessageId: String | null,   // unique, sparse
  createdById: ObjectId | null,    // admin user for MANUAL, null for email

  createdAt: Date,
  updatedAt: Date
}
```

Indexes on `orders` — create all of these explicitly, do not rely on Mongoose autoIndex in production:

```js
{ externalOrderId: 1 }                                  // unique
{ gmailMessageId: 1 }                                   // unique, sparse
{ restaurantId: 1, serviceDate: 1, status: 1 }          // store dashboard
{ trainNo: 1, serviceDate: 1, stationCode: 1 }          // run grouping
{ status: 1, serviceDate: 1 }                           // admin views
{ 'delivery.agentIds': 1, serviceDate: 1 }              // agent's runs
```

```ts
// trainstatuses
{
  _id: ObjectId,
  trainNo: String,
  serviceDate: String,             // 'YYYY-MM-DD'
  stationCode: String,
  etaAt: Date | null,
  delayMinutes: Number | null,
  platform: String | null,
  fetchedAt: Date
}
// index: { trainNo: 1, serviceDate: 1, stationCode: 1 } unique
```

```ts
// unparsedinbox
{
  _id: ObjectId,
  source: String,
  rawPayload: Object,
  reason: String,                  // UNKNOWN_OUTLET | MISSING_FIELD | PARSE_FAILED
  resolved: { type: Boolean, default: false },
  createdAt: Date
}
```

**Why `events` is embedded and not its own collection:** an order accumulates roughly eight events over its life and they're only ever read alongside the order. The 16MB document limit is not remotely a concern. If you later add high-frequency per-order telemetry, split it out then.

---

## 4. Status machines

**Retail order:**

```
RECEIVED -> ACCEPTED -> KOT_PRINTED -> PREPARED -> DISPATCHED -> DELIVERED
                                                              -> FAILED
   |  (any point before DISPATCHED)
   +-> CANCELLED
```

**Bulk order:**

```
ENQUIRY -> QUOTED -> RECEIVED -> ACCEPTED -> KOT_PRINTED -> PREPARED -> DISPATCHED -> DELIVERED
   |                                                                              -> FAILED
   +-> LOST
```

`transitionOrder(orderId, toStatus, userId, meta)`:

- Opens a Mongo session and transaction
- Re-reads the order inside the transaction
- Validates the transition against an explicit allow-list map; throws on anything not listed
- Updates `status` and `$push`es the event, in one `updateOne`
- Commits

This function is the only place `status` is ever written. Enforce with the same ESLint rule that guards direct model access.

**Concurrency:** two store managers can hit "Mark Prepared" at once. Guard every transition with a status precondition in the filter — `updateOne({ _id, status: expectedFrom }, ...)` — and treat `matchedCount === 0` as a conflict, not a success. This matters more in Mongo than it would elsewhere because there's no serialisable isolation to fall back on.

**Completeness guard:** an order cannot leave `QUOTED` for `RECEIVED` until `restaurantId`, `contactPhone`, `amountPaise`, `paymentMode`, and `readyBy` are all populated. Enforce inside `transitionOrder`, not in the UI.

---

## 5. Roles and data isolation

| | Admin | Store manager | Delivery agent |
|---|---|---|---|
| Manage restaurants, users | yes | no | no |
| See all outlets' orders | yes | own outlet only | assigned runs only |
| Create/quote bulk enquiries | yes | no | no |
| Accept order, print KOT, mark prepared | yes | yes | no |
| Dispatch and deliver | no | no | yes |
| Unparsed inbox | yes | no | no |

All isolation is application-level — see section 2. The `orderRepo.scoped(ctx)` pattern, the ESLint guard, and the cross-tenant integration test are the whole defence. Treat that test as a release blocker.

---

## 6. Retail ingestion (Gmail)

### Transport

- Gmail API with `users.watch` -> Google Pub/Sub -> webhook -> `history.list` -> `messages.get`.
- **Watch expires after 7 days.** Add a daily cron job to renew it. If missed, ingestion silently stops — alert if no order has arrived in N hours during business hours.
- Idempotency: unique indexes on `externalOrderId` and `gmailMessageId`. Catch duplicate-key errors (code 11000) and treat them as a no-op success, not an error.
- Store the full raw body in `rawPayload` before parsing anything.

### YatriRestro parser

Sample input:

```
*Order From YatriRestro*
*Order Id : #1000584805*
-----------------------------
Outlet Name- HOTEL GANGA GALAXY
Station Code/Name - KANPUR CENTRAL-CNB
-----------------------------
*Delivery Details*
Neelesh Soni |  9752446747 |  12506-NORTH EAST EXP |  B5-37 | 27-Aug 13:25
-----------------------------
*Order Items*
Paneer Paratha With Curd Combo - 1 |
-----------------------------
*Amount-236 - CASH_ON_DELIVERY*
-----------------------------
Note-
1000584805.
Thank You.
```

(The real email has emoji prefixes on the delivery line: person, phone, train, seat, clock.)

Expected output:

```json
{
  "source": "YATRIRESTRO",
  "externalOrderId": "1000584805",
  "outletName": "HOTEL GANGA GALAXY",
  "stationName": "KANPUR CENTRAL",
  "stationCode": "CNB",
  "contactName": "Neelesh Soni",
  "contactPhone": "9752446747",
  "trainNo": "12506",
  "trainName": "NORTH EAST EXP",
  "coach": "B5",
  "berth": "37",
  "rawSeat": "B5-37",
  "scheduledArrival": "2026-08-27T13:25:00+05:30",
  "items": [{ "name": "Paneer Paratha With Curd Combo", "qty": 1 }],
  "amountPaise": 23600,
  "paymentMode": "COD"
}
```

Extraction rules:

| Field | Rule |
|---|---|
| Order ID | `/Order Id\s*:\s*#?(\d+)/` |
| Outlet | `/Outlet Name-\s*(.+)/`, trimmed |
| Station | `/Station Code\/Name\s*-\s*(.+)-([A-Z]{2,5})\s*$/` — code is the final hyphen segment |
| Delivery line | Split on `\|`, trim each. Identify parts by leading emoji, with positional fallback if emoji are stripped |
| Train | `/^(\d{5})-(.+)$/` |
| Seat | `/^([A-Z]+\d*)-(\d+)$/` -> coach, berth. Always keep the raw string |
| Time | `27-Aug 13:25`, parsed in Asia/Kolkata |
| Items | Every non-empty line between `*Order Items*` and the next `-----`, matched `/^(.+?)\s*-\s*(\d+)\s*\|/`. **Loop — do not match once** |
| Amount | `/Amount-\s*([\d.]+)\s*-\s*(\w+)/`, x100 to paise. `CASH_ON_DELIVERY` -> `COD` |

Edge cases that must be handled:

- **Year inference.** The date has no year. Take the year from the email received timestamp; if the parsed date is more than 7 days *before* that timestamp, add one year (handles the December-to-January rollover).
- **Multiple items.** Sample has one. Real orders have several.
- **Seat variants.** `B5-37`, `S3-45`, `A1-12`, coach with no berth. Store `rawSeat` regardless.
- **Outlet name mismatch.** If the outlet doesn't match a restaurant `name` or one of its `aliases`, **do not guess** — write to `unparsedinbox` with reason `UNKNOWN_OUTLET`. Routing to the wrong kitchen is worse than a delay.
- **Any required field null** -> `unparsedinbox`. Never insert a partial order.
- **Trailing pipe** after item quantity — capture whatever follows into item notes rather than discarding.

Write this as a deterministic parser with a test suite. Include the sample above as a fixture, plus a multi-item variant and a malformed variant that must land in the unparsed inbox.

DailyYatri gets its own parser module behind the same `OrderParser` interface. Do not try to write one parser for both.

---

## 7. Bulk enquiry (paste-to-parse)

Sample input:

```
*Query*
Date =03-Sep
Location =Kanpur Central
Train no -
Time  = 7:30PM
Pax = 75
Menu = 2pcs Egg Curry + Dry aloo jeera + Dal Fry + Jeera Rice + 3 Butter Roti + Sweet ( Gulab Jamun )  + Salad + Pickel + Tissue + Spoon, water bottle 500ml.
```

The admin enquiry form has a textarea at the top. Admin pastes the WhatsApp message; it pre-fills the form; admin corrects and completes.

Parser rules:

- Split on newlines. Split each line on the first `=` or `-`.
- Lowercase and strip the key, match against an alias map: `date`, `location|station`, `train no|train|train number`, `time`, `pax|no of pax|pax count`, `menu`.
- Unrecognised lines append to `notes` — never drop them.
- Store the pasted original in `rawPayload`. This is the record of what was actually requested when a dispute arises.

**Non-negotiable behaviours:**

- The parse is never authoritative. Every field is a normal editable input, pre-filled. A bad parse is fine — a human is completing the form anyway.
- **Menu is a single textarea**, not a repeatable item builder. Nobody will type a 12-component thali into 12 rows. Line breaks preserved; this text goes straight onto the KOT.
- Alongside it, a **checklist of packing items** (water bottle, tissue, spoon, pickle, salad) that admin ticks. These become items with `isPacking: true`. This is the only part of the menu worth structuring, because it's the part that gets forgotten on a 75-pax order.
- Bulk creates **one** item with `qty = pax` and the full menu in `spec`. Do not shred the thali into eleven rows of qty 75.

Admin then assigns an outlet, quotes an amount, sets payment mode, captures contact name and phone, sets `readyBy`, and confirms. Only then does the order appear on a store dashboard.

---

## 8. Train tracking

```ts
interface TrainStatusProvider {
  getStatus(trainNo: string, serviceDate: string, stationCode: string):
    Promise<{ etaAt: Date | null; delayMinutes: number | null; platform: string | null }>;
}
```

Put every provider behind this interface. There is no reliable free official API — options are RapidAPI providers (IndianRail, ConfirmTkt, RailYatri) or NTES scraping, which is fragile. Assume you will swap providers at least once; that must be a one-file change.

**Polling policy** (BullMQ repeating job):

- Only poll trains with at least one active order today.
- More than 60 min to scheduled arrival -> every 10 min.
- 30 to 60 min -> every 5 min.
- Under 30 min -> every 2 min.
- Cache by `(trainNo, serviceDate, stationCode)` so ten orders on one train cost one call.
- On provider failure, keep the last known value, mark it stale, and show the age in the UI. Never present a stale ETA as live.

If `trainNo` is null, skip polling and use `scheduledArrival` with `timingSource: 'SCHEDULED'`. When admin later fills in the train number, the order upgrades to `LIVE` automatically.

---

## 9. Dispatch logic

**Cooking is fire-and-forget.** The store manager prints the KOT on receipt, the cook cooks, food waits on the ready shelf. No priority queue, no computed cook deadlines. The store dashboard sorts by order arrival time.

**Only dispatch is timed.** The unit of dispatch is a **train run**, not an order:

```
run = all PREPARED orders grouped by (trainNo, serviceDate, stationCode)
dispatchAt = etaAt - walkToPlatformMinutes - bufferMinutes (default 5)
```

When `dispatchAt` is reached, send one FCM push to the assigned agent(s):

> Leave now — 12506 North East Exp, platform 3, 4 orders, arriving 13:25

Two details that matter operationally:

- **Sort the run by coach**, so the agent walks the platform in one direction rather than doubling back. A halt at a station like Kanpur Central may be five minutes.
- **Include the platform number** in the push. Platform changes are common and an agent on the wrong platform misses the halt entirely.

**Delay guard on KOT.** When the store manager clicks Generate KOT, check live status. If the train is delayed beyond a configurable threshold (default 45 min), show a confirm dialog — "12506 is running 1h 20m late, expected 14:45. Print KOT anyway?" The manager decides; the system doesn't block. This is the only place fire-and-forget needs a safety net.

**Multiple agents per run.** A 75-pax bulk handover is not a one-agent job. `delivery.agentIds` is an array from day one, even if v1 only ever assigns one.

---

## 10. Screens

### Admin
- Restaurants: CRUD, station code, outlet name aliases, walk-to-platform minutes
- Users: create store managers and delivery agents, assign outlet
- All orders: filter by outlet, date, status, train
- Bulk enquiry: paste-to-parse form, quote, confirm
- Unparsed inbox: raw payload, reason, resolve by correcting and re-ingesting
- Runs: today's train runs, assigned agents, status

### Store manager
Scoped to one outlet. Default view is **today**, with an Upcoming tab (bulk orders booked ahead must not clutter today's screen).

- Order cards: order ID, type badge, train + coach/seat or handover point, items, amount, payment mode
- `readyBy` countdown shown only when set (bulk)
- Actions: Accept -> Generate KOT (opens print view) -> Mark Prepared
- Live SSE feed for new orders, with an audible alert

### KOT print view
Thermal-printer friendly (80mm, monospace, high contrast). Two sections:

- **KITCHEN** — cooked items and quantities, plus the full composite `spec` text for bulk thalis, printed once with the pax count at the top
- **PACKING** — items with `isPacking: true`: tissue, spoon, water bottle, pickle, salad

Header: order ID, train, coach/seat or handover point, pax, ready-by time.

### Delivery app (React Native)
- Login, FCM token registration
- Today's assigned runs, grouped by train
- Run detail: platform, live ETA with delay, countdown to leave, order list sorted by coach
- Per order: coach/seat or handover point, contact name and phone (tap to call), items, **amount to collect prominently if COD, or clearly marked PREPAID**
- Mark Dispatched (whole run), Mark Delivered (per order) with OTP or photo proof
- Mark Failed with a reason
- Must work with intermittent connectivity — queue writes locally and sync

---

## 11. Build phases

Ship in this order. Getting one order from email to delivered is the entire risk of this project; everything after that is CRUD.

### Phase 1 — Spine
- Mongoose schemas, explicit index creation script, seed data (2 restaurants, 1 admin, 2 store managers, 2 agents)
- Local Mongo running as a single-node replica set so transactions work in dev
- Auth with roles
- `orderRepo.scoped(ctx)` + ESLint guard against direct model access
- `transitionOrder()` with the allow-list, transaction, and status-precondition filter
- **Cross-tenant isolation test** — store manager A gets 404 on store B's order by ID
- Manual order creation form (admin) to exercise the pipeline without email
- Store dashboard: list, accept, KOT print view, mark prepared

*Done when:* an admin can create an order by hand, the correct store manager sees it and only it, prints a KOT, marks it prepared — with a full event trail — and the isolation test passes.

### Phase 2 — Retail ingestion
- Gmail watch + Pub/Sub webhook + history sync
- Daily watch-renewal cron and a staleness alert
- YatriRestro parser with test fixtures
- Outlet alias matching; unparsed inbox with an admin resolve flow
- Duplicate-key handling as idempotent no-op
- SSE feed to the store dashboard with new-order alert

*Done when:* a real YatriRestro email lands in the inbox and appears on the correct store dashboard within seconds, a duplicate is silently ignored, and a malformed one lands in the unparsed inbox instead of being dropped.

### Phase 3 — Delivery app
- Expo app, auth, FCM registration
- Runs grouped by train, order list sorted by coach
- Dispatch and deliver with proof capture and COD amount collection
- Offline write queue

*Done when:* an agent gets a push, opens a run, and delivers an order end to end without network in the station.

### Phase 4 — Live train timing
- `TrainStatusProvider` interface and one concrete implementation
- Polling job with the tiered cadence and per-train caching
- `dispatchAt` computation and the leave-now push
- Delay guard dialog on KOT print
- Stale-data indicator in the UI

*Done when:* a delayed train visibly pushes the leave-now alert later, and the agent's screen shows a live ETA with delay minutes and platform.

### Phase 5 — Bulk and admin polish
- Enquiry paste-to-parse form, quote and confirm flow with the completeness guard
- Packing checklist and two-section KOT
- Upcoming tab on the store dashboard
- Multi-agent run assignment
- Admin analytics via aggregation pipelines: orders per outlet, delivery success rate, average received-to-delivered time

---

## 12. Non-goals for v1

Explicitly out of scope. Don't let these creep in:

- WhatsApp Business API integration (paste-to-parse covers it; the API needs Meta business verification and a template-message regime)
- Customer-facing app or order tracking page
- Payment gateway (COD and invoice only)
- Automated agent assignment or route optimisation
- Multi-station orders on a single train run
- Inventory or stock management

---

## 13. Things that will break in production

1. **Mongo not running as a replica set** — transactions throw at runtime, not at startup. Local dev needs `mongod --replSet rs0` and an `rs.initiate()`. Atlas is a replica set by default. Assert replica-set mode on boot and fail loudly.
2. **Cross-tenant leak from a direct model call** — the single biggest risk of this stack choice. The ESLint guard and isolation test are the only things standing between you and a store manager seeing a competitor's orders.
3. **Mongoose silently dropping fields** — a typo in a field name writes nothing and throws nothing unless `strict: true` is set on every schema.
4. **Gmail watch expiry** — silent ingestion failure. Renew daily, alert on no-orders.
5. **Aggregator template changes** — parsers break without warning. The unparsed inbox catches this; monitor its volume.
6. **Train API downtime or rate limits** — never let this block order flow. Degrade to scheduled time.
7. **Duplicate emails** — unique indexes plus 11000 handling.
8. **Lost status updates under concurrency** — always filter transitions on the expected `from` status and treat zero matches as a conflict.
9. **Platform changes** — refresh platform on every poll, not just once.
10. **Poor station connectivity** — the delivery app must work offline.
11. **Wrong-outlet routing** — never fuzzy-match an outlet name into a live order. Fail into the unparsed inbox.
