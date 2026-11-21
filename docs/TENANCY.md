# Tenancy: how RailServe keeps companies apart

RailServe is multi-tenant: every customer company is a **tenant**, and our
own operation is the **primary tenant**. One database, a `tenantId` on every
tenant-owned document, and a guard that refuses any query that forgets it.

## The rules for code

1. **Every query on a tenant-owned model names the tenant.** `Order`,
   `Restaurant`, `Listing`, `User`, `MenuItem`, `PrintJob`, `Payment`,
   `UnparsedInbox`, `RiderLocation`, `WaConversation`, `WaMessage`,
   `Counter`, `IngestState` and `Station` all carry `tenantId`. Put
   `tenantId: ctx.tenantId` in the filter; `findById(id)` becomes
   `findOne({ _id: id, tenantId })`. Aggregates start with a `$match` on it.
2. **Every write stamps it.** `create`, `new Model()`, upserts (an equality
   filter on `tenantId` stamps the new row), `insertMany`.
3. **The tenant comes from where the request arrives, never from its payload.**
   - Pages and actions: the session's `ctx.tenantId` (`requireAuth`,
     `requireRole`, `requirePermission`).
   - Rider app: the bearer token's user.
   - Gmail, MSG91 and other env-configured integrations: `getPrimaryTenantId()`.
   - Print agents: the station found by its token.
   - Crons: loop over active tenants.
4. **Natural-string ids** (`Counter`, `MenuItem`, `Station`, `IngestState`) go
   through `tenantKey(tenantId, key)`; read them back with `naturalKey(id)`.
   The primary tenant keeps the bare legacy key, so an older image still runs
   after a rollback.
5. **Crossing tenants is explicit and rare:** `.setOptions({ allTenants: true })`
   or an `{ allTenants: true }` aggregate option, with a comment saying why.
   Only login (phone is unique across the platform), print-token lookups,
   train-delay fan-out and the platform console do it today.
6. **`Model.collection.*` and `bulkWrite` skip the guard.** Avoid them; where
   one is unavoidable its filter must name the tenant itself.

## The guard

`src/lib/tenancy/plugin.ts`. `TENANT_GUARD=throw` makes a missed tenant an
error; `log` logs it and puts a tenantless write on the primary tenant.
Unset, production logs and everything else throws (dev, tests, CI). Staging
sets `throw`. **Before a second company goes live in production, set
`TENANT_GUARD=throw` there** once the logs show no `[tenant-guard]` lines.

## Migration

`src/instrumentation.ts` runs `ensureTenancy()` at boot, before the server
takes requests: it creates the primary tenant if missing, stamps every
document without a `tenantId` with it, and creates every index. It is
idempotent and additive. The old global unique indexes (order number, bank
reference, WhatsApp phone) stay until a second tenant exists, then
`ensureIndexes({ multiTenant: true })` replaces them with per-tenant ones.

### First production run

Measured on 2026-11-21: about 7,700 orders, but 12,400 print jobs holding
1 GB of ticket images. Stamping those is the slow part. The deploy script
waits up to 3 minutes for `/login` before rolling back; deploy at a quiet
hour. Expiring old print jobs (a planned clean-up) shrinks this, and the
nightly backups with it.

## Access

- **Roles** stay the shape of a job.
- **Permissions** (`src/lib/permissions.ts`) are the switches behind each
  action. Each company can change them for store managers and telecallers in
  Settings → Roles & access. Use `requirePermission('…')` in pages and
  actions, and `can` / `assertCan` (`src/lib/access.ts`) elsewhere.
- **Super admins** are the phones in `PLATFORM_ADMIN_PHONES` on the primary
  tenant. They see `/platform`, the console for adding, listing and
  suspending companies.
