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

## Deploying a change

Not a git push. Code is baked into the image at build time, so a code change
is a **rebuild**, not a restart:

```bash
# from the repo root
rsync -az -e "ssh -i <key>" \
  --exclude node_modules --exclude .next --exclude .git --exclude /mobile \
  --exclude '.env*' --exclude tsconfig.tsbuildinfo --exclude captures \
  ./ root@<vps>:/root/railserve/

ssh <vps> 'cd /root/railserve && docker compose -f docker-compose.prod.yml up -d --build app'
```

Two excludes are load-bearing. `'.env*'` protects `/root/railserve/.env.production`,
the only copy of the production secrets — overwrite it and the container loses
its database URI and Gmail credentials on next start. `/mobile` needs the
leading slash: without it rsync also matches `src/lib/mobile/`.

`npm run build` runs `verify` (lint + typecheck) first, so a type error fails
the image build rather than shipping.

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
| `CRON_TOKEN` | recommended | Shared secret for `/api/cron/train-poll`. Leave unset and the endpoint is open. |
| `TRAIN_API_PROVIDER` | no | `simulator` (default), `rapidapi`, or `railkit` — currently `railkit`. |
| `TRAIN_API_KEY` / `TRAIN_API_HOST` | no | `TRAIN_API_HOST` applies to the `rapidapi` provider only; the `railkit` adapter takes just the key and ignores it. |
| `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | no | Delivery photo storage. All blank ⇒ photo capture does not appear and delivery still works. |
| `GMAIL_*` | no | Email ingestion. All blank ⇒ orders are pasted or entered by hand. |
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
17  4 * * *  -> /api/cron/gmail-watch    # daily — renews the Gmail watch
30  3 * * *  -> /root/railserve-backups/backup.sh
```

`/root/railserve-cron/run-cron.sh` curls `$TARGET_URL` (in its `.env`, now
`https://bitestation.elvo.in`) with `x-cron-token`, which must match the
container's `CRON_TOKEN` or every tick 401s silently. It logs to `cron.log`
and writes `status.json` — read that for health rather than SSHing in blind.

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

## Retired: Vercel and Atlas

Both are still up and reachable, and neither is production any more.

- `railserve.vercel.app` still builds on every push to `main`, but nothing
  drives its cron endpoints and Gmail push no longer reaches it.
- The Atlas `railserve` database is **frozen** at its 2026-09-14 state (547
  orders, `historyId` 86144). The live data has since diverged.

So Vercel is *not* a working fallback. Falling back means re-syncing the VM's
database into Atlas first and repointing cron and Pub/Sub back — otherwise it
silently serves stale orders. The Vercel/Atlas runbook that used to live in
`docs/VERCEL.md` was folded into this file and deleted on 2026-09-15; recover it
from git history if that setup ever needs reviving.

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
