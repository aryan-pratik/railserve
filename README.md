# RailServe

Train food delivery order tracking. Orders are entered by an admin, cooked at a
partner outlet near a railway station, and delivered to a passenger's seat (or a
bulk handover point) while the train is halted.

Built to [docs/plan.md](docs/plan.md). This is the **MVP**: a working slice
through all three roles rather than a finished phase 1.

## Stack

Next.js 16 (App Router) · TypeScript · MongoDB via Mongoose 9 · Auth.js v5 ·
Tailwind 4 · Vitest

## Running it

MongoDB **must** be a replica set — every status change runs in a transaction,
and transactions throw at runtime on a standalone `mongod`. The app asserts
replica-set mode at boot rather than letting the first status change fail.

```bash
docker compose up -d          # Mongo (rs0 replica set) + Redis, both self-initiating
cp .env.example .env.local    # then set AUTH_SECRET (see the file for a one-liner)

npm install
npm run indexes               # explicit index creation — autoIndex is off
npm run seed                  # 2 outlets, 1 admin, 3 store managers, 2 riders
npm run seed:orders           # optional: a few orders so the screens aren't empty

npm run dev
npm run worker                # in a second terminal: train polling + leave-now
```

Without the worker the app still runs; train status is then only refreshed when
a page asks for it, and the leave-now alert cannot fire with no browser open.

### Sign in

Login is by **phone number**, not email. All seeded users share the password in
`SEED_PASSWORD` (default `password`).

| Phone | Role | Lands on |
|---|---|---|
| `9000000001` | Admin | `/admin` |
| `9000000002` | Store manager — Ganga Galaxy (CNB) | `/store` |
| `9000000003` | Store manager — Annapurna (PRYJ) | `/store` |
| `9000000006` | Store manager — **both outlets** | `/store` |
| `9000000004` | Delivery agent — Ravi Kumar | `/agent` |
| `9000000005` | Delivery agent — Suresh Yadav | `/agent` |

### Upgrading an existing database

A store manager used to hold one outlet (`users.restaurantId`); they now hold a
list (`users.restaurantIds`), because one manager commonly runs several kitchens
at the same station. Run once, before `npm run indexes`:

```bash
npm run migrate:multi-outlet
```

It is idempotent and goes through the raw driver on purpose — Mongoose's
`strictQuery` silently drops a filter on a field the schema no longer declares,
which would match every user instead of the ones needing migration.

Existing login cookies carry the old single-outlet claim. They fail closed (no
outlets, so nothing is visible) rather than falling through to an unscoped read
— sign out and back in after migrating.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | **Runs `verify` first**, then builds |
| `npm run verify` | Lint + typecheck |
| `npm test` | Integration tests against a real replica set |
| `npm run indexes` | Create every index explicitly (idempotent) |
| `npm run seed` | Outlets and staff (idempotent) |
| `npm run seed:orders` | Demo orders (replaces previous demo data) |
| `npm run migrate:multi-outlet` | One-shot `restaurantId` → `restaurantIds` (idempotent) |
| `npm run worker` | BullMQ worker: train polling, leave-now, Gmail watch |
| `cd mobile && npx expo start` | The delivery agent app |

All five plan phases are implemented. See **What is deliberately not built**
for the integrations that need credentials you supply.

## The screens

Both consoles are built around **the train**, not the order. One rider carries
one train's orders to the platform in one trip, so that is the unit the kitchen
should assemble and the unit an admin should staff.

| Route | Who | What |
|---|---|---|
| `/store` | Store manager | The board: one card per train, orders nested inside, whole-train Accept / Print KOTs / Mark ready |
| `/store/history` | Store manager | Lookup once an order has left the board |
| `/store/orders/new` | Store manager | Paste an aggregator message, or a phone order by hand |
| `/admin` | Admin | The same board across every outlet, with rider assignment |
| `/admin/orders` | Admin | Filterable list across all outlets |
| `/admin/enquiries` | Admin | Bulk pipeline: paste → quote → confirm |
| `/admin/inbox` | Admin | Emails that would not parse. The nav badge is unresolved count |
| `/admin/setup` | Admin | Outlets and staff |

### Riders are not assigned work

Nobody dispatches a rider to a run. A rider is attached to one or more outlets
in Setup, sees every live run at those outlets, takes whatever is ready, and the
system records who actually handled it — `delivery.agentIds` is written by
`transitionOrder` on DISPATCHED / DELIVERED / FAILED rather than filled in ahead
of time. An admin can correct that record on a single order, but there is no
assignment step anywhere in the workflow.

This makes outlet membership the whole of a rider's data scope, exactly as it is
for a manager: `orderRepo.scopeFilter` gives both roles
`{ restaurantId: { $in: ctx.restaurantIds } }`, and a user holding no outlets
matches nothing rather than everything.

**A rider carried over from the old model holds no outlets and will see an empty
board** until an admin gives them one — `npm run migrate:multi-outlet` counts and
warns about exactly that.

### Delivery proof

A rider can attach a photo at the door. It is optional on purpose: a dead camera
or no signal at a platform must never stop an order being closed.

The image goes straight from the device to Cloudflare R2 via a short-lived
presigned URL — it never passes through this server. `delivery.proofValue` holds
the object *key*, never a URL, because presigned URLs expire; viewing one signs
a fresh URL per render. Photos are downscaled on the device first (1280px, ~200 KB)
because the upload happens from a station.

Leave the `R2_*` variables blank and photo capture simply does not appear.
Delivery still works — that is a supported configuration, not a broken one.

**Cards are ordered by when the train actually arrives**, not by the timetable
and not by when the order came in — `sortRunsByUrgency` in `src/lib/runs.ts`.
A train running 90 minutes late drops below one that is on time, because the
food that leaves first is the food that should be cooked first. The coloured
edge on each card is the same fact at a glance: red under 20 minutes, amber
under 45.

A store manager holds a **list** of outlets and sees all of them on one board,
each order tagged with its kitchen. There is no outlet switcher — checking the
other counter should not cost a click.

### Design system

Tokens live in `src/app/globals.css`; primitives in `src/components/ui.tsx`.
Type is Inter for the UI and JetBrains Mono for train numbers, seat codes and
the KOT — set in `src/app/layout.tsx` and nowhere else. Slashed zeros are on
globally: train numbers and coach codes get read aloud and typed back in, and an
ambiguous `0`/`O` is a wrong delivery.

Status colour is decided in exactly one place, `STATUS_STYLES`. The KOT view is
deliberately outside all of this — black on white for an 80mm thermal head.

## The two things holding this together

MongoDB gives no row-level security and no referential integrity, so both are
application-level and both are load-bearing.

**1. Store isolation.** `src/lib/repo/orderRepo.ts` is the only module permitted
to touch the `Order` model. Scope is applied *before* the query reaches Mongo,
so a call site cannot forget it. An ESLint rule fails the build on direct model
access anywhere else — and because Next 16 removed `next lint` and the `eslint`
config option, `npm run build` runs `verify` first, or the guard would not guard.

`tests/isolation.test.ts` is a release blocker: store manager A must get nothing
for store B's order, by ID.

**2. Status changes.** `transitionOrder()` in `src/lib/repo/transitionOrder.ts`
is the only writer of `status`. It runs in a transaction, re-reads inside it
through the caller's scope, validates the edge and the caller's role against an
allow-list, and filters the update on the expected `from` status so a concurrent
writer loses rather than silently overwriting.

## Live train status

Set nothing and you get the **simulator**: deterministic per (train, date,
station), so a demo is reproducible and the delay guard actually fires
sometimes. It exists so the whole timing path is exercisable without a paid
account — it is not a forecast of anything, and the UI says so.

To use real data, set `TRAIN_API_PROVIDER=rapidapi` and `TRAIN_API_KEY` in
`.env.local`. Nothing outside `src/lib/train/` imports a concrete provider, so
swapping vendor is one function in `src/lib/train/index.ts`.

Polling follows plan §8: only trains with an active order today, at 10/5/2
minute tiers by proximity to arrival, cached per `(trainNo, serviceDate,
stationCode)` so ten orders on one train cost one call. On provider failure the
last known values are kept, the row is marked with the error, and every screen
showing that ETA labels it with its age — a stale ETA is never presented as
live.

## Delivery app (Expo)

`mobile/` is the React Native app for delivery agents.

```bash
cd mobile
npm install
npx expo start          # scan the QR with Expo Go
```

It finds the dev server automatically from the Expo host — a phone cannot reach
`localhost`, since that is the phone. Override with `EXPO_PUBLIC_API_URL` for a
real deployment. Sign in with an agent phone (`9000000004` / `password`); the
app refuses other roles rather than shipping screens it does not have.

**Auth** is a bearer token signed with the same `AUTH_SECRET` as the web
session — one identity, two transports — verified by HMAC with no database round
trip, though the user record is re-read on every request so a deactivated agent
loses access immediately rather than at token expiry.

**Offline** (plan §13.10 — station connectivity is poor): the last runs payload
is cached, so the app opens with real content and no signal. Deliveries are
applied to local state immediately and queued in AsyncStorage, then flushed as
a batch when the app regains signal or comes back to the foreground. Every
mutation carries a client id and is replay-safe server-side — a repeated
delivery comes back `alreadyDone` rather than as an error, so a flaky
reconnection cannot double-record or wedge the queue.

**Push** registers an Expo token against the user's `fcmToken`. Nothing sends to
it yet: that needs a Firebase service account. The leave-now countdown is on
screen regardless, and the worker records the alert on the order's event log.

## Bulk enquiries

`/admin/enquiries/new` takes a pasted WhatsApp message and pre-fills the form.
The parse is **never authoritative** (plan §7): every field stays an ordinary
editable input, unrecognised lines land in notes rather than being dropped, and
the pasted original is kept as the record of what was actually asked for.

An enquiry lives at `ENQUIRY`, becomes `QUOTED` when an outlet, price, payment
mode, contact and ready-by are set, and only reaches a kitchen at `RECEIVED`.
The completeness guard is enforced inside `transitionOrder`, not by the form —
so it holds however the transition is reached.

The menu stays one block of text with `qty = pax`, never shredded into a row
per component, and the packing checklist at confirmation becomes the KOT's
PACKING section.

## Retail ingestion

Parsing, outlet matching, idempotency and the unparsed inbox all work with no
Google account: paste an aggregator email at **`/admin/inbox`** and it goes
through the identical pipeline the Gmail transport uses.

To turn on live ingestion, set `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` /
`GMAIL_REFRESH_TOKEN` / `GMAIL_TOPIC_NAME` and point a Pub/Sub push
subscription at `POST /api/gmail/webhook`. The worker then renews the watch
daily — it expires after 7 days and takes ingestion with it silently — and
warns every 30 minutes if no order has arrived during business hours.

An email that cannot be parsed, or names an outlet we do not recognise, lands
in the unparsed inbox with its raw body intact. **Outlet matching is exact
only** — name or alias, case- and space-insensitive, never fuzzy. Routing an
order to the wrong kitchen is worse than delaying it, so an ambiguous or
near-miss name is a refusal.

> The **DailyYatri parser is a scaffold**. The plan supplies a worked sample for
> YatriRestro only, so its field regexes are written against the layout these
> aggregators generally use and its fixtures are invented, not observed. A real
> DailyYatri email will most likely land in the unparsed inbox until it is
> checked against one — which is the designed failure, not a silent misroute.

## What is deliberately not built

Stubbed or hardcoded for the MVP, and designed so none of them need a schema
change:

- **Sending FCM push.** Device tokens are registered; delivering a push needs a
  Firebase service account. The leave-now alert is recorded on the order's event
  log by the worker and shown in-app instead.
- **Analytics, unparsed inbox, SSE.**

Known gaps that are *not* deferred by design, just unbuilt: there is no edit flow
for an existing order, and the KOT delay-guard dialog from plan §9 needs live
train status.
