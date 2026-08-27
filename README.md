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
npm run seed                  # 2 outlets, 1 admin, 2 store managers, 2 agents
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
| `9000000001` | Admin | `/admin/orders` |
| `9000000002` | Store manager — Ganga Galaxy (CNB) | `/store` |
| `9000000003` | Store manager — Annapurna (PRYJ) | `/store` |
| `9000000004` | Delivery agent — Ravi Kumar | `/agent` |
| `9000000005` | Delivery agent — Suresh Yadav | `/agent` |

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
| `npm run worker` | BullMQ worker: train polling, leave-now, cache prune |

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

- **WhatsApp paste-to-parse** for bulk enquiries. `ENQUIRY` and `QUOTED` exist in
  the status machine and are tested; no UI drives them yet. Bulk orders are
  entered directly at `RECEIVED`.
- **FCM push.** The leave-now alert is recorded on the order's event log by the
  worker and rendered in-app; screens poll (15–20s). Real push needs a Firebase
  service account.
- **Native mobile app.** The delivery view is responsive web.
- **Analytics, unparsed inbox, SSE.**

Known gaps that are *not* deferred by design, just unbuilt: there is no edit flow
for an existing order, and the KOT delay-guard dialog from plan §9 needs live
train status.
