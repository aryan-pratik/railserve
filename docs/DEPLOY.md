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

## ⚠️ `bitestation.elvo.in` serves a stale build

That domain points at the cron VPS, where nginx serves a copy of the app left
over from an **abandoned cutover** — an attempt to move production off Vercel
that was never finished. It is still up and still answers requests, which is
exactly what makes it dangerous.

Measured 2026-09-15:

```
bitestation.elvo.in  ->  the cron VPS, nginx/1.24.0 (Ubuntu)
static assets Last-Modified: Fri, 11 Sep 2026 11:26 GMT
```

Eight commits landed after that build — the HomeBytes parser, inline order-item
editing, per-item notes, the Yatribhojan coach-code fix. **None of them are in
the copy that domain serves.** Vercel has them; it rebuilds on every push.

This matters beyond curiosity, because the domain is written into the KOT print
agent as "the production app URL" — `agent/README.md`, `agent/print-agent.mjs`
and `docs/KOT_PRINTING.md` all use it for `SERVER_URL`. Any print agent running
that value is talking to four-day-old server code against the live database.
If printing misbehaves in a way the current code shouldn't produce, check this
first. Repointing `SERVER_URL` at `railserve.vercel.app` is the fix; tearing
down the stale nginx site so the domain stops answering is the better one.

Verify before assuming it's still true — a rebuild or a teardown both change
the answer:

```bash
curl -sI https://bitestation.elvo.in/_next/static/chunks/<any-chunk>.js | grep -i last-modified
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
