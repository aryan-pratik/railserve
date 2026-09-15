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
with Atlas. `/root/railserve-backups/backup.sh` runs nightly at 03:30 UTC:
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
silently serves stale orders. `docs/VERCEL.md` documents that setup and is now
historical.

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
