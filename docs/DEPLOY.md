# Where RailServe is deployed

**Production is Vercel: `https://railserve.vercel.app`.** A separate VPS runs
the cron scheduler. A *stale* copy of the app also answers on another domain —
read the warning below before trusting it.

For Vercel specifics — env vars, Atlas, staging, Gmail push — see `VERCEL.md`.
This doc is the map of what runs where.

## Production

| Piece | Where | Notes |
|---|---|---|
| App | Vercel project `railserve` | Auto-builds and promotes on every push to `main`. `vercel --prod --yes` deploys from local disk if a push isn't possible. |
| Database | MongoDB Atlas, db `railserve` | `railserve_dev` is local + staging; `MONGODB_URI_TEST` is a third, vitest-only database, truncated every run. |
| Cron | An external VPS (**not** Vercel Cron) | See below. |
| Staging | `https://railserve-staging.vercel.app` | Preview scope pinned to the `staging` branch. |

`vercel.json` holds nothing but a `$schema` line, deliberately — there are no
crons, rewrites, or overrides to declare. Don't add a `crons` array expecting
it to work; Hobby allows one invocation per day.

## ⚠️ `bitestation.elvo.in` is a stale, self-hosted copy — not production

That domain points at the cron VPS, which also runs a **full self-hosted stack**
left over from a migration off Vercel that was started and never finished:

```
bitestation.elvo.in
  -> nginx (Certbot TLS)  ->  127.0.0.1:3000
  -> docker container `railserve-app`   (built 2026-09-11, up since)
  -> docker container `railserve-mongo` (mongo:7, its OWN database)
```

Built from `/root/railserve` on the box — an rsync'd copy of the repo with no
`.git`. **Its `Dockerfile` and `docker-compose.prod.yml` exist only on that
box; neither is in this repo**, so the self-hosted setup can't be rebuilt from
git as it stands.

Two things follow, and they matter in opposite directions.

**It is stale.** Static assets are dated 2026-09-11 11:26 GMT, and eight commits
landed after that — the HomeBytes parser, inline order-item editing, per-item
notes, the Yatribhojan coach-code fix. None are in what that domain serves.

**It is isolated.** `MONGODB_URI` in the container is
`mongodb://mongo:27017/railserve` — its own Mongo container, *not* Atlas. It
cannot corrupt production data, and its database holds an unrelated partial
dataset (9 restaurants, 246 train statuses, 70 unparsed inbox rows).

So the risk isn't data corruption, it's **confusion and credentials**:

- `bitestation.elvo.in` is the `SERVER_URL` documented for the KOT print agent
  (`agent/README.md`, `agent/print-agent.mjs`, `docs/KOT_PRINTING.md`). An agent
  pointed there polls a near-empty unrelated database and prints nothing, while
  looking correctly configured.
- The container carries **real production secrets** — `GMAIL_REFRESH_TOKEN`,
  `GMAIL_CLIENT_SECRET`, `TRAIN_API_KEY`, `AUTH_SECRET`, `CRON_TOKEN`,
  `GMAIL_WEBHOOK_TOKEN` — on a box exposed to the internet on 80/443, running
  code four days behind `main`. Its 70 unparsed-inbox rows mean it has really
  reached the live mailbox at some point.

Either finish the migration or tear it down; leaving a credentialled, stale,
publicly reachable copy running is the worst of the three. If you tear it down,
repoint `SERVER_URL` in the print-agent docs at `railserve.vercel.app` first.

Re-check rather than trusting this snapshot — a rebuild or teardown changes it:

```bash
curl -sI https://bitestation.elvo.in/_next/static/chunks/<any-chunk>.js | grep -i last-modified
ssh <box> 'docker ps --format "{{.Names}} {{.Status}}"'
```

## Cron

Vercel Hobby allows **one cron invocation per day**, useless for a two-minute
tick, so the schedule lives on the VPS:

```
*/2 * * * *  -> /api/cron/train-poll     # every 2 minutes
*   * * * *  -> /api/cron/gmail-sync     # every minute
17  4 * * *  -> /api/cron/gmail-watch    # daily, only if Gmail push is on
```

They authenticate with `x-cron-token`, which must match Vercel's `CRON_TOKEN`
exactly or every tick 401s silently. The runner writes a `status.json` next to
itself — check that for last-run health rather than SSHing in blind.

**Which host the cron targets is the one thing to confirm on the box**, not
from this doc: `TARGET_URL` in the runner's `.env` decides whether the schedule
drives Vercel or the stale local copy. It should be
`https://railserve.vercel.app` — the alias, so it follows every redeploy.

Host, key and paths live in **`docs/INFRA.local.md`**, gitignored on purpose:
this repo is public and a live root SSH endpoint doesn't belong in it. Ask a
maintainer if you don't have that file.

If the VPS stops, polling stops **silently** — nothing alerts. The app keeps
working and reverts to refreshing train status only while someone has a page
open; the leave-now alert stops firing entirely. `/admin/inbox` eventually
shows an ingestion staleness banner, which in practice is the first symptom
anyone notices.

## Scheduler history

The scheduler has moved once, and stale copies of the old address are the main
way to waste an afternoon here.

- **Current: a Contabo VPS**, since the Azure subscription expired September 2026.
- **Previous: an Azure VM** (`azureuser@172.197.160.41`) — gone, expired rather
  than stopped. It also hosted a path-prefixed copy of the app at
  `:8080/railserve/` behind nginx, shared with the `uiis` project. That copy
  was not migrated. Anything describing an app at `/railserve/`, a
  `railserve-web` / `railserve-worker` pm2 process, or VM-local Mongo and Redis
  containers is describing that dead machine.
- A third address, `azureuser@20.205.129.242`, appears in older notes and is
  equally stale. If a doc hands you an IP, check it against `INFRA.local.md`.

## Legacy: the Azure sub-path deployment

Kept only because these two bugs cost real time and would recur immediately if
a sub-path deployment were rebuilt anywhere. **Neither applies to Vercel.**
`docker-compose.yml` plus `README.md` remain the supported way to run the app
on a plain host.

It worked by setting Next's `basePath` to `/railserve` at build time via
`BASE_PATH` (`next.config.ts` gates on it; unset everywhere else, and
`VERCEL.md` says in bold never to set it on Vercel — it would move the whole
app under a prefix nothing links to).

1. **nginx's `$host` drops the port.** Next's Server Actions CSRF check
   compares `Host` against `Origin`; the browser's `Origin` includes the
   non-default port (`:8080`) and `$host` doesn't, so every action failed. A
   sub-path location block needs `proxy_set_header Host $http_host;`.

2. **Auth.js's `redirectTo` is `basePath`-blind.** Next's own `redirect()`
   prepends `basePath`; `signIn(..., { redirectTo })` and `signOut(...)` use
   Auth.js's own resolution, which does not. A bare `/` sent users to the host
   root — a different project entirely on that VM. `src/app/login/actions.ts`
   and `src/app/actions/session.ts` build the target from `process.env.BASE_PATH`
   for this reason; keep that if either call changes.

   That deployment also needed `AUTH_TRUST_HOST=true` or Auth.js rejects every
   request with `UntrustedHost`. Still required on Vercel — see `VERCEL.md`.
