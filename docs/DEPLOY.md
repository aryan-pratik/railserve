# Where RailServe is deployed

**Production is self-hosted on the Contabo VPS: `https://bitestation.elvo.in`.**
Migrated off Vercel + MongoDB Atlas on 2026-09-15.

```
bitestation.elvo.in
  -> nginx (Certbot TLS, ports 80/443)
  -> 127.0.0.1:3000
  -> docker container `railserve-app`      (Next 16 standalone)
  -> docker container `railserve-mongo`    (mongo:7, replica set rs0)
```

Everything lives on one box: the app, the database, the cron scheduler, and
the backups. Host, key and paths are in **`docs/INFRA.local.md`**, gitignored
because this repo is public.

## The one rule: code reaches production only through `main`

> **Never copy code to the VPS by hand.** No `rsync`, `scp`, `git archive`
> or editing files over SSH, and no `docker compose up --build` on the box.
> That was how deploys worked before 2026-11-21. It shipped unreviewed,
> uncommitted and half-finished code (v2 went live by accident that way) and
> left no record of what was running.
>
> If anyone asks for a "quick deploy" straight to the server, do not do it.
> Tell them how the work should go instead:
>
> 1. Create a branch, for example `fix/kitchen-timer`, from `dev`. For an
>    urgent production fix, branch from `main` instead.
> 2. Push the branch and open a pull request into `dev`, or into `main` for
>    the urgent fix.
> 3. CI must pass. Merge the pull request.
> 4. `dev` deploys to staging by itself. Check the change there.
> 5. Merge `dev` into `main` through a pull request. Production deploys by
>    itself. An urgent fix that went straight to `main` is merged back into
>    `dev` afterwards.
>
> The same applies to AI agents working in this repo: explain this flow to
> the developer and stop, rather than deploying.

## Branches and environments

| Branch | Goes to | How |
|---|---|---|
| `main` | Production, `bitestation.elvo.in` (VPS) | `.github/workflows/deploy-prod.yml`, automatically on every merge |
| `dev` | Staging, `railserve-staging.vercel.app`, database `railserve_staging` on Atlas | Vercel's Git integration, automatically on every merge |
| any other branch | Nothing. CI checks only | `.github/workflows/ci.yml` |

**Nobody pushes to `main` or `dev` directly.** Both branches are protected on
GitHub: every change arrives through a pull request, CI (lint, typecheck,
tests) must pass first, force-pushes and deletion are blocked, and the rule
applies to admins too. Merging into `main` is the moment a change goes live.

`dev` currently carries the unfinished v2 UI, which `main` does not have. So
`dev` is only merged into `main` once v2 is signed off; until then urgent
production fixes go branch -> `main`, then `main` is merged into `dev`.

## What a deploy does

Every merge into `main` runs `.github/workflows/deploy-prod.yml`:

1. lint, typecheck and the test suite, against a throwaway Mongo replica set
   in the runner (never Atlas);
2. builds the production image on GitHub's runner and pushes it to
   `ghcr.io/aryan-pratik/railserve:<commit sha>`, so the VPS never builds;
3. on the VPS, runs `scripts/deploy/vps-deploy.sh`: a pre-deploy `mongodump`
   (`/root/railserve-backups/predeploy-*.gz`, two newest kept), pulls and swaps
   the container, checks `/login` answers 200, and **rolls back to the previous
   image automatically** if it doesn't.

There is no approval step. The deployed image is recorded in
`/root/railserve/.env` as `RAILSERVE_IMAGE`, which compose reads. The GitHub
secrets `VPS_HOST`, `VPS_SSH_KEY` (a deploy-only key, comment
`github-actions-deploy@railserve` in the box's `authorized_keys`) and
`VPS_KNOWN_HOSTS` live on the `production` environment, which only `main` may
deploy to.

## Rolling back

Revert the bad commit in a pull request into `main`. Merging it deploys the
previous code the normal way. If the new container never answers, the deploy
script has already put the old image back by itself.

### Prove the deploy landed

```bash
ssh <vps> 'docker ps --format "{{.Names}} {{.Status}} {{.Image}}"'
curl -sI https://bitestation.elvo.in/login | head -1
```

`railserve-app` should be `Up` for minutes, on the image tagged with the
merged commit. Reading the box like this is fine; changing it is not.

### A new environment variable

`src/lib/env.ts` validates with zod at startup, so code that needs a new
variable crash-loops on deploy (and gets rolled back) unless the owner has
added it to `/root/railserve/.env.production` first. That file is the only
copy of the production secrets; only the owner edits it.

### The `DOCKER_BUILD` gate

`next.config.ts` sets `output: 'standalone'` only when `DOCKER_BUILD` is set,
and the Dockerfile sets it. Without that, `next build` emits no
`.next/standalone` and the Dockerfile's `COPY --from=builder /app/.next/standalone ./`
fails. This gate lived only on the VM until 2026-09-15 and is now committed —
don't drop it while "cleaning up" the config.

## Environment variables

Set these in `/root/railserve/.env.production` on the VPS (root-only, loaded by
`docker-compose.prod.yml`'s `env_file`). Everything except the first three is
optional — the app degrades honestly without them.

Changes take effect on container **restart**, not rebuild:
`docker compose -f docker-compose.prod.yml up -d app`.

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | **yes** | `mongodb://mongo:27017/railserve?replicaSet=rs0` — the compose service name, **with a database name**. Without one the driver silently uses `test`. |
| `AUTH_SECRET` | **yes** | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_TRUST_HOST` | **yes** | Set to `true`. Auth.js refuses every request with `UntrustedHost` otherwise, and it fails at runtime, not at build. |
| `SEED_PASSWORD` | no | Only used by the seed script; irrelevant in production. |
| `CRON_TOKEN` | recommended | Shared secret for every `/api/cron/*` endpoint (`train-poll`, `gmail-sync`, `gmail-watch`, `print-retry`). Leave unset and they are open. |
| `TRAIN_API_PROVIDER` | no | `simulator` (default), `rapidapi`, `railkit` (RailKit v1/NTES only) or `railkit-v2` (v2/WIMT first, v1 as fallback) — currently `railkit`. The value is validated at boot, so an image older than `railkit-v2` refuses to start with it: switch to it right before merging the code that supports it, and set it back to `railkit` **before** rolling back to an older image. Readings V1 had to serve are logged as `[train-fallback]`. |
| `TRAIN_API_KEY` / `TRAIN_API_HOST` | no | `TRAIN_API_HOST` applies to the `rapidapi` provider only; the `railkit` adapter takes just the key and ignores it. |
| `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | no | Delivery photo storage. All blank ⇒ photo capture does not appear and delivery still works. |
| `GMAIL_*` | no | Email ingestion. All blank ⇒ orders are pasted or entered by hand. |
| `APP_URL` | for Link Gmail | Public address, e.g. `https://bitestation.elvo.in`. Google returns companies to `$APP_URL/api/gmail/link/callback` after Link Gmail. Blank ⇒ taken from the request. |
| `MAILBOX_TOKEN_KEY` | recommended | 32+ random characters. Encrypts each company's linked-Gmail token in the database. Blank ⇒ derived from `AUTH_SECRET`. **Never change it once set**: every linked Gmail would have to be linked again. |
| `GMAIL_SEND_REFRESH_TOKEN` | for emails | Send-only Google token for messages to companies that are joining (`npm run gmail:setup -- --send`). Separate from `GMAIL_REFRESH_TOKEN`, which only reads orders. Blank ⇒ messages are shown on their screen only. |
| `DISPATCH_BUFFER_MINUTES` / `KOT_DELAY_THRESHOLD_MINUTES` | no | Defaults 5 and 45. |

**Do not set `BASE_PATH`.** It exists for an nginx sub-path deployment and here
would move the whole app under a prefix nothing links to — the app owns its own
domain.

`MONGODB_URI_TEST` is a local-only concern — the test suite reads it, production
never does. Leave it out.

## Cron

Same box, driving the app over its public URL:

```
*/2 * * * *  -> /api/cron/train-poll     # every 2 minutes
*   * * * *  -> /api/cron/gmail-sync     # every minute
*/2 * * * *  -> /api/cron/print-retry    # every 2 minutes — direct-print stations only
17  4 * * *  -> /api/cron/gmail-watch    # daily — renews the Gmail watch
30  3 * * *  -> /root/railserve-backups/backup.sh
```

`print-retry` is needed only once a station prints directly (a
`Station.directPrinterHost` is set) — it re-sends tickets whose delivery failed
because the printer was briefly unreachable. Stations on the poll/agent path
are untouched by it, so the line is harmless when none exist. Without it, a
ticket that fails delivery is never retried and just sits `pending`. See
`docs/KOT_PRINTING.md`.

`/root/railserve-cron/run-cron.sh` curls `$TARGET_URL` (in its `.env`, now
`https://bitestation.elvo.in`) with `x-cron-token`, which must match the
container's `CRON_TOKEN` or every tick 401s silently. It logs to `cron.log`
and writes `status.json`. Read **`cron.log`**, not `status.json`, for health: the
latter's `gmail-watch` entry loses updates to a race with the every-minute jobs
and can read days stale while the job is running fine.

The daily `gmail-watch` line is **not optional**. A Gmail watch dies after
exactly 7 days and takes push ingestion with it, raising no error anywhere.

## Backups

Self-hosted Mongo has no managed backup behind it — that safety net went away
with Atlas. `/root/railserve-backups/backup.sh` runs nightly at 03:30 **CEST** (01:30 UTC
— the box's clock is `Europe/Berlin`, so every crontab time above is local, not
UTC; the daily `gmail-watch` at `17 4` fires at 02:17 UTC):
`mongodump --gzip` of the `railserve` database, 14 days of retention, appending
to `backup.log`. The database is ~2MB, so retention costs nothing.

Restore:

```bash
docker cp <archive>.gz railserve-mongo:/tmp/r.gz
docker exec railserve-mongo mongorestore --uri="mongodb://localhost:27017" \
  --archive=/tmp/r.gz --gzip --drop
```

The same directory holds the pre-migration snapshots: the VM's own stale
database (`vm-pre-sync-*.gz`) and the final Atlas export (`atlas-*.gz`).

## Gmail push

Pub/Sub subscription `railserve-webhook` (GCP project `bitestation-507214`,
owned by the `bitestation0001@gmail.com` account) pushes to
`https://bitestation.elvo.in/api/gmail/webhook?token=<GMAIL_WEBHOOK_TOKEN>`.
The token in that URL must match the container's env var exactly, or every
notification 401s and ingestion silently falls back to the one-minute poll.

Repointing it, if the host ever changes:

```bash
gcloud pubsub subscriptions modify-push-config railserve-webhook \
  --project=bitestation-507214 --push-endpoint="https://<host>/api/gmail/webhook?token=<token>"
```

### Setting push up from scratch

The poll above caps order and payment latency at 60 seconds. Push takes it to
1–3 seconds: Gmail -> Pub/Sub -> `/api/gmail/webhook` -> `history.list`. The
webhook route, `renewGmailWatch()` and `/api/cron/gmail-watch` all exist
already; what turns it on is a topic, a subscription, and one `users.watch()`
call. `npm run gmail:watch` prints the current state and the exact steps.

In the **same Google Cloud project as the OAuth client**:

1. Enable Pub/Sub (`console.cloud.google.com/apis/library/pubsub.googleapis.com`).
2. Create a topic, e.g. `gmail-notifications`.
3. On that topic, grant **Publisher** to `gmail-api-push@system.gserviceaccount.com`.
   Gmail cannot publish without it, and `users.watch()` then fails with an
   error naming the topic rather than the missing grant — which is a
   confusing hour if you skip this step.
4. Create a **push** subscription with endpoint
   `https://bitestation.elvo.in/api/gmail/webhook?token=<GMAIL_WEBHOOK_TOKEN>`
   and an **acknowledgement deadline of 60s**. The webhook runs a full history
   sync before answering; the 10s default expires underneath it and Pub/Sub
   redelivers, which is wasteful rather than harmful (ingestion is idempotent).
5. Set `GMAIL_TOPIC_NAME=projects/<project-id>/topics/gmail-notifications` and
   `GMAIL_WEBHOOK_TOKEN=<long random string>` locally and in `.env.production`.
6. `npm run gmail:watch -- --renew` to register it, then add the daily
   `/api/cron/gmail-watch` line above.

**The daily renewal is not optional.** A watch dies after exactly 7 days and
takes ingestion with it, raising no error anywhere — the app keeps serving and
the mailbox keeps filling while nothing arrives. Renewing daily rather than
weekly leaves six consecutive failures' worth of slack. `/admin/inbox` shows a
banner when the watch is inside 24 hours of expiry or nothing has ingested for
`INGEST_STALE_ALERT_HOURS` during business hours.

**Keep the one-minute poll running alongside push.** They are idempotent on
`externalOrderId`, `gmailMessageId` and `rrn`, so the overlap costs nothing and
the poll is what catches up if a push notification is ever dropped.

- **Hobby allows one cron invocation per day.** On Hobby, either accept that or
  drive the endpoint from an external scheduler — it accepts `GET` and `POST`,
  and takes `x-cron-token`, `Authorization: Bearer`, or `?token=`.
- Nothing breaks without it: train times still refresh whenever a page renders.
  Only the leave-now alert, which must fire with no browser open, is lost.
- Without `gmail-sync` running, order intake stays fully manual (paste at
  `/admin/inbox`) — nothing else depends on it.

Keep the one-minute poll running alongside push — they are idempotent on
`gmailMessageId`, and the poll is what catches a dropped notification.

## Companies joining, and Link Gmail

New companies apply at `/signup`, upload five documents, link their Gmail
and pay; a platform admin reviews them on `/platform`. These have to be set
up once, outside the code:

0. **`TENANT_GUARD=throw`** in `/root/railserve/.env.production` (and in the
   staging site's Vercel env). With a second company on the server, a query
   that forgets its company must fail rather than read everyone's rows
   (docs/TENANCY.md). Until it is set, `/signup` refuses with "New companies
   cannot join this server yet", by design.
1. **Google Cloud project `bitestation-507214`** (account
   `bitestation0001@gmail.com`), APIs & Services:
   - Credentials → the existing OAuth client → *Authorized redirect URIs*:
     add `https://bitestation.elvo.in/api/gmail/link/callback` and, for
     local work, `http://localhost:3000/api/gmail/link/callback`.
   - OAuth consent screen → *Publishing status* → **In production**. In
     "Testing", every linked Gmail stops working after 7 days. Until Google
     verifies the app (the Gmail read permission is "restricted"), people see
     an "unverified app" warning and at most 100 can link.
2. **Settings** (`APP_URL`, `MAILBOX_TOKEN_KEY`, `GMAIL_SEND_REFRESH_TOKEN`)
   go into `/root/railserve/.env.production`, which only the owner edits
   (see "A new environment variable"). All three are optional: without them
   the app starts as before, Link Gmail uses the request's address, and
   messages are shown on screen only.
3. **nginx** on the box: `client_max_body_size 6m;` for the site, so a PDF
   up to 5 MB can be uploaded (photos are shrunk in the browser anyway).

A linked Gmail is read exactly like the server mailbox: pushed through the
same Pub/Sub topic (the push names the mailbox), polled every minute by
`/api/cron/gmail-sync`, and its watch renewed daily by
`/api/cron/gmail-watch`. Watches are only registered where
`GMAIL_TOPIC_NAME` is set (production), so linking on staging or locally
never takes the watch away from production.

## Retired: Vercel and Atlas

**The Vercel project was deleted on 2026-09-15.** `railserve.vercel.app` and
`railserve-staging.vercel.app` both 404 now. There is no Vercel fallback, and
`vercel` commands in this repo will not work — the project link under `.vercel/`
was removed with it.

Three consequences worth knowing:

- Its env vars are gone with it. Five existed there that the VM does not have:
  `MONGODB_URI_TEST` and `SEED_PASSWORD` (test/seed only, irrelevant in
  production) and `DISPATCH_BUFFER_MINUTES`, `KOT_DELAY_THRESHOLD_MINUTES`,
  `INGEST_STALE_ALERT_HOURS`. All three of the latter were marked Sensitive, so
  their values were unreadable even before deletion. **Production now runs on
  the code defaults for them** (5, 45 and 6 — see `src/lib/env.ts`). If those
  were ever deliberately tuned, set them explicitly in `.env.production`.
- Already-installed rider apps built before 2026-09-15 point at
  `railserve.vercel.app` and now have no backend. `mobile/eas.json` and
  `mobile/src/config.ts` were repointed at `bitestation.elvo.in`, but
  `EXPO_PUBLIC_API_URL` is inlined at build time — **riders need a new EAS
  build**, not just an app restart.
- The `staging` EAS profile still points at `railserve-staging.vercel.app`,
  which is also gone. Point it at a real host before using that profile.

**MongoDB Atlas is disconnected but intact.** Nothing in production connects to
it. Its three databases are left untouched on purpose:

| Database | State |
|---|---|
| `railserve` | Frozen at 2026-09-15, 548 orders — the pre-migration production copy, kept as a rollback option |
| `railserve_dev` | **Still live** — `.env.local` points here for local development |
| `railserve_test` | **Still live** — the vitest suite truncates this every run |

So the cluster cannot be deleted without first moving local dev and the test
suite elsewhere. A final export sits on the VPS at
`/root/railserve-backups/atlas-FINAL-*.gz`.

## First deploy on a fresh box

```bash
npm run indexes    # explicit index creation; autoIndex is off on purpose
npm run seed       # outlets + staff. Change the passwords immediately after.
```

Point `MONGODB_URI` at the target database in the shell when running these —
every `npm run` script loads `.env.local`, which is dev.

Afterwards: sign in and change every seeded password, and check `/admin` loads
and `/api/cron/train-poll` returns `{"ok":true}`.

## Single points of failure

Worth naming, because everything is on one box now:

- One VPS, no replication. If it goes, the app and database go together — the
  nightly dump is the only recovery path, and it lives on the same disk.
  Copying backups off-box is the obvious next improvement.
- If the VPS stops, cron stops **silently**. Train status then only refreshes
  while someone has a page open, the leave-now alert stops firing, and order
  ingestion halts. `/admin/inbox` shows a staleness banner eventually, which
  in practice is the first thing anyone notices.

## Legacy: the Azure sub-path deployment

The Azure VM (`azureuser@172.197.160.41`) expired in September 2026 and also
hosted a path-prefixed copy at `:8080/railserve/` behind nginx, shared with the
`uiis` project. Not migrated, not coming back. Two bugs from it are worth
keeping, because both would recur in any sub-path deployment:

1. **nginx's `$host` drops the port.** Next's Server Actions CSRF check
   compares `Host` against `Origin`; the browser's `Origin` includes the
   non-default port and `$host` doesn't, so every action failed. Use
   `proxy_set_header Host $http_host;`.

2. **Auth.js's `redirectTo` is `basePath`-blind.** Next's own `redirect()`
   prepends `basePath`; `signIn`/`signOut` use Auth.js's own resolution, which
   does not. `src/app/login/actions.ts` and `src/app/actions/session.ts` build
   the target from `process.env.BASE_PATH` for this reason.

`BASE_PATH` stays unset on the current deployment — the app owns its own
domain now.
