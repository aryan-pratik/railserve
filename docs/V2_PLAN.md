# RailServe v2: multi-tenant SaaS rebuild

Branch: `v2`. Started 2026-11-21. Companion document: `docs/REVAMP_INVENTORY.local.md`
(gitignored) lists every feature of v1 that must survive, and the known bugs.

## 1. Goal

Turn RailServe from a single-company tool into a product we sell to other
train-food operators. We run the platform as **super admin**; each customer is
a **tenant** with their own outlets, staff, riders, aggregator mail, WhatsApp
number and printers. Tenants never see each other.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Platform** | The whole system, run by us. |
| **Super admin** | Our team. Manages tenants, plans, integrations and support. Not a member of any tenant. |
| **Tenant** | One customer company (an operator that runs kitchens and delivers on trains). Our own operation is tenant #1. |
| **Tenant admin** | What v1 calls ADMIN: full control inside one tenant. |
| **Store manager, telecaller, rider** | Same as v1, inside one tenant. |
| **Outlet** | A kitchen, belonging to exactly one tenant. |
| **Station** | A railway station (public data, shared). Each tenant has its own *station settings*: default kitchen, print token, direct printer. |

## 3. Decisions (recommended defaults; change them before Phase 1 starts)

1. **One database, `tenantId` on every document.** Not a database per
   tenant. Super admin needs cross-tenant views (health, usage, billing), and
   one database keeps indexes, backups and transactions simple. Isolation is
   enforced in code, but structurally this time (see §4), not by convention.
2. **A user belongs to exactly one tenant.** Phone numbers are unique
   per tenant, not globally. Super admins are platform users with no tenant.
   If a person ever needs two tenants, they get two accounts.
3. **Sales-led onboarding.** Super admin creates the tenant and its first
   admin. No public sign-up in v2.0; that can come later.
4. **Tenant resolution from the session**, not from a subdomain. One domain,
   one login page, tenant comes from the user. Subdomains or custom domains
   are a later add-on.
5. **Aggregator email by forwarding, not per-tenant Gmail OAuth.** Each
   tenant gets an inbound address on our domain (for example
   `orders+acme@in.railserve.app`). They auto-forward from their aggregator
   mailbox. We receive by an inbound-email service (Postmark, SES, or
   Cloudflare Email Routing) that POSTs to a webhook. This removes the Gmail
   watch, history cursor and per-tenant Google verification entirely. Gmail
   OAuth can remain as an optional connector later.
6. **Billing is manual in v2.0.** Plans and limits are modelled (outlets,
   users, orders per month) and enforced softly, but invoices are issued by
   hand. Razorpay subscriptions are a Phase 5 item.
7. **Train status is a platform service.** One provider key, one shared
   cache per train, date and station. Usage is metered per tenant.
8. **Shared code, one app.** v2 is the same repository and the same Next.js
   app, with the data layer reshaped. Parsers, `transitionOrder`, the ledger
   and the print pipeline are kept and hardened, not rewritten.

## 4. Tenant isolation design

This is the part that cannot be retrofitted later, so it goes first.

- **`tenantId` on every tenant-owned collection:** Order, Restaurant,
  Listing, User, MenuItem, PrintJob, Payment, UnparsedInbox, RiderLocation,
  WaConversation, WaMessage, Counter, IngestState (becomes per-tenant
  "IngestSource"), and new tenant-station settings.
- **Platform-owned collections, no tenantId:** Tenant, PlatformUser,
  Station (public data), TrainStatus (shared cache), Plan, AuditLog (platform
  level, keyed by tenantId as a field).
- **Enforcement:** a `tenantModel(Model)` wrapper (or a Mongoose plugin) that
  requires a tenant context for every find, update, aggregate and delete, and
  injects `tenantId` into the filter. A call without context throws. The
  existing `orderRepo.scopeFilter` becomes the second layer (role scope within
  the tenant). The ESLint ban on raw model access is extended to the whole
  `src/lib/repo` tree, with the wrapper as the only exemption.
- **Indexes:** every tenant collection index starts with `tenantId`. Unique
  keys become compound: `(tenantId, externalOrderId, source)`,
  `(tenantId, phone)`, `(tenantId, rrn)`, `(tenantId, source, menu key)`.
  Indexes are declared on the schemas and created on boot (fixing the v1
  "autoIndex off, hope someone ran the script" problem).
- **Session carries `tenantId`.** `requireRole` returns a context with
  `tenantId`, user, role and outlet scope. Super admin context has a
  `tenantId` only when impersonating.
- **Per-tenant integrations** live on the Tenant document, encrypted at
  rest: inbound mail address and allowlist, WhatsApp provider credentials,
  FoodOnTrains keys (per outlet), proof-photo bucket prefix, feature flags.
- **Webhooks resolve the tenant from the destination**, never from the
  payload: inbound mail by the `+tag` address, WhatsApp by the receiving
  number, print agents by their token.
- **Tests:** an isolation test suite that creates two tenants with identical
  data and asserts that every repo function, API route and page returns only
  its own tenant's rows. This is run in CI on every change.

## 5. Super admin console (`/platform`)

- **Tenants:** list, create, suspend, archive. Plan and limits. Feature flags.
- **Tenant detail:** outlets, users, order volume, last 30 days activity.
- **Health per tenant:** ingestion stale, unparsed backlog, print agents
  offline, WhatsApp webhook errors, train-provider errors. The same checks v1
  shows only on `/admin`, now pushed as alerts to us.
- **Integrations setup:** inbound address and forwarding instructions,
  WhatsApp connection, train provider, storage.
- **Impersonate:** "open as tenant admin", time-boxed, written to the audit
  log, with a visible banner.
- **Platform audit log:** every super-admin action.
- **Usage and metering:** orders, messages, train lookups, prints per
  tenant per month. This feeds billing later.
- **Support tools:** re-run ingestion for a tenant, requeue prints, reset a
  user's password.

## 6. Tenant-side changes from v1

Everything in the inventory stays. What changes because of tenancy:

- **Setup gains a "Company" tab:** name, logo, timezone (fixed to IST for
  now), KOT header, default walk-to-platform minutes, inbound mail address
  (read-only, with the forwarding guide), sender allowlist, WhatsApp status.
- **Stations:** a tenant picks the stations they serve from the shared list
  and sets their own default kitchen, print token and direct printer per
  station.
- **Menu, counters, payments, inbox, chat** are all per tenant.
- **Print agent** config is unchanged for the user; the token now identifies
  tenant plus station.
- **Mobile app** is unchanged for riders; the token carries the tenant.

## 7. Phases

Hotfixes to v1 production go to `main` and are merged into `v2` as we go.

**Phase 0: Hotfixes on main (days).** Gmail sync dropping orders, delete-on-GET
route, staff edit leak, board search crash, WhatsApp webhook returning 200 on
failure, print failures invisible. Production is losing data today.

**Phase 1: Tenancy foundation (2–3 weeks).**
- Tenant, PlatformUser, Plan models. Tenant context in session and
  `requireRole`.
- `tenantModel` wrapper, lint rule, schema-declared indexes created on boot.
- Add `tenantId` to every model and every repo function. Compound unique
  keys.
- Migration script: all existing production data becomes tenant #1.
- Two-tenant isolation test suite.
- Nothing visible changes for users at the end of this phase.

**Phase 2: Back-end cleanup (2–3 weeks).** The items from the inventory
that the UI depends on:
- One status module: enum on `status`, every list derived from it, RATING_ORDER
  given real semantics (or removed), the admin override restricted to the
  allow-list plus a documented "void" action.
- Transactional cancel approval, run actions reporting per-order results,
  audit events on every edit.
- Pagination everywhere; the 500 caps removed.
- Printing as an outbox: KOT_PRINTED only after the job is queued; failed
  jobs visible and retryable; PrintJob rows expire.
- Mobile mutations idempotent by `clientId`, queue cleared on sign-out,
  client timestamps honoured.
- One live-update mechanism (a single per-tenant SSE change feed with a
  cursor) replacing the six.
- Inbound email by forwarding; Gmail kept behind a flag for tenant #1 until
  cut over.

**Phase 3: Design system (1–2 weeks).** Tokens, components, one confirm
style, one inline-edit style, one status colour scale, dark mode from day
one. Built from the references you collect.

**Phase 4: Screen rebuild, by role (6–8 weeks).** In order of pressure:
kitchen board and store screens, rider mobile app (one surface, with parity
decided), telecaller, tenant admin, super admin console. Each role ships
when done; old screens stay until their replacement is live.

**Phase 5: Commercial (after launch).** Razorpay subscriptions, usage
limits enforced, self-serve sign-up, subdomains or custom domains, tenant
data export, SLA monitoring.

## 8. Open questions for you

1. Our own operation is tenant #1. Does it get any special treatment, or is
   it a normal tenant we log into like a customer? (Recommend: normal tenant.)
2. Can two tenants share one outlet or one rider? (Recommend: no.)
3. Will customers forward aggregator mail, or do they expect us to pull from
   their Gmail? This decides whether Gmail OAuth stays on the roadmap.
4. Pricing basis: per outlet, per order, or flat tiers? Needed only for the
   usage meters in Phase 1, not for billing itself.
5. Who are the first two or three target customers? Knowing their station
   count, aggregator mix and whether they use WhatsApp shapes the defaults.
