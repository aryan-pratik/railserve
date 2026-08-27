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
docker compose up -d          # single-node rs0 replica set, self-initiating
cp .env.example .env.local    # then set AUTH_SECRET (see the file for a one-liner)

npm install
npm run indexes               # explicit index creation — autoIndex is off
npm run seed                  # 2 outlets, 1 admin, 2 store managers, 2 agents
npm run seed:orders           # optional: a few orders so the screens aren't empty

npm run dev
```

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

## What is deliberately not built

Stubbed or hardcoded for the MVP, and designed so none of them need a schema
change:

- **Gmail ingestion** and the YatriRestro/DailyYatri parsers. The order document
  already carries `source`, `externalOrderId`, `gmailMessageId` and `rawPayload`.
- **WhatsApp paste-to-parse** for bulk enquiries. `ENQUIRY` and `QUOTED` exist in
  the status machine and are tested; no UI drives them yet. Bulk orders are
  entered directly at `RECEIVED`.
- **Live train tracking.** `timingSource` is always `SCHEDULED`;
  `scheduledArrival` comes from manual entry. `trainstatuses` has no model file
  because nothing reads or writes it.
- **Dispatch automation and the leave-now push.** Dispatch is a manual button.
- **FCM.** Screens poll instead (15–20s).
- **Native mobile app.** The delivery view is responsive web.
- **Analytics, unparsed inbox, SSE.**

Known gaps that are *not* deferred by design, just unbuilt: there is no edit flow
for an existing order, and the KOT delay-guard dialog from plan §9 needs live
train status.
