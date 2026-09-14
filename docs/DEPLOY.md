# Where RailServe is deployed

Production is **Vercel**, at `https://railserve.vercel.app`. Cron is driven
from a small external VPS. Nothing else is live.

For the Vercel specifics — env vars, Atlas setup, staging, Gmail push — see
`VERCEL.md`. This doc is the map of *what runs where*, and the history of
what used to.

## Production

| Piece | Where | Notes |
|---|---|---|
| App | Vercel project `railserve` | Auto-builds and promotes on every push to `main`. `vercel --prod --yes` deploys from local disk if a push isn't possible. |
| Database | MongoDB Atlas, db `railserve` | `railserve_dev` is local + staging; `MONGODB_URI_TEST` is a third, vitest-only database that gets truncated every run. |
| Cron | An external VPS (**not** Vercel Cron) | See below. |
| Staging | `https://railserve-staging.vercel.app` | Preview scope pinned to the `staging` branch. |

`vercel.json` holds nothing but a `$schema` line, and that's deliberate —
there are no crons, rewrites, or overrides to declare. Don't add a `crons`
array to it expecting it to work; see below.

## Cron

Vercel Hobby allows **one cron invocation per day**, which is useless for a
two-minute tick, so the schedule lives on a VPS that does nothing but curl
the already-deployed endpoints:

```
*/2 * * * *  -> /api/cron/train-poll     # every 2 minutes
*   * * * *  -> /api/cron/gmail-sync     # every minute
17  4 * * *  -> /api/cron/gmail-watch    # daily, only if Gmail push is on
```

All three hit `https://railserve.vercel.app` — the alias, not a deployment
URL, so it follows every redeploy without needing an update — and
authenticate with `x-cron-token`, which must match Vercel's `CRON_TOKEN`
exactly or every tick 401s silently.

The box holds a URL and a token and nothing else: no database credentials,
no app code, no node/docker/nginx. It is a clock, not a server. It writes a
`status.json` next to its runner script — check that for last-run health
rather than SSHing in blind.

**Host, key, and paths are in `docs/INFRA.local.md`**, which is gitignored
on purpose: this repo is public, and a live root SSH endpoint doesn't belong
in it. If you're a new dev and don't have that file, ask for it.

If the VPS stops, polling stops **silently** — nothing alerts on it. The app
keeps working and simply reverts to refreshing train status only while
someone has a page open, and the leave-now alert stops firing entirely.
`/admin/inbox` will eventually show a staleness banner for ingestion, which
in practice is the first visible symptom.

## Scheduler history

The scheduler has moved once, and stale copies of the old address are the
main way to waste an afternoon here.

- **Current: a Contabo VPS**, since the Azure subscription expired in
  September 2026.
- **Previous: an Azure VM** (`azureuser@172.197.160.41`). Gone — expired,
  not stopped. It *also* hosted a second, path-prefixed copy of the whole
  app at `:8080/railserve/` behind nginx, shared with the `uiis` project.
  **That copy was not migrated and is not coming back**; only the crontab
  moved to Contabo. Anything you read describing an app at `/railserve/`, a
  `railserve-web` / `railserve-worker` pm2 process, or VM-local Mongo and
  Redis containers is describing that dead machine.

A third address, `azureuser@20.205.129.242`, appears in older notes. That
one is stale too. If a doc gives you an IP, check it against
`INFRA.local.md` before trusting it.

## Legacy: the Azure sub-path deployment

Kept only because these two bugs cost real time and would recur immediately
if the sub-path deployment were ever rebuilt somewhere else. **None of this
applies to Vercel.** `docker-compose.yml` plus `README.md` remain the
supported path for running the app on a plain host.

The deployment worked by setting Next's `basePath` to `/railserve` at build
time via the `BASE_PATH` env var (`next.config.ts` gates on it; it is unset
everywhere else, and `VERCEL.md` says in bold never to set it on Vercel —
it would move the whole app under a prefix nothing links to).

1. **nginx's `$host` drops the port.** Next's Server Actions CSRF check
   compares `Host` against `Origin`, and the browser's `Origin` includes the
   non-default port (`:8080`) while `$host` doesn't, so the check failed on
   every action. A sub-path location block must use
   `proxy_set_header Host $http_host;`, which preserves the port.

2. **Auth.js's `redirectTo` is `basePath`-blind.** Next's own `redirect()`
   prepends `basePath` automatically, but `signIn(..., { redirectTo })` and
   `signOut(..., { redirectTo })` use Auth.js's own resolution, which does
   not. A bare `/` sent users to the host root — which, on that VM, was a
   different project entirely. `src/app/login/actions.ts` and
   `src/app/actions/session.ts` build the target from `process.env.BASE_PATH`
   for this reason; keep that if either call changes.

   That deployment also needed `AUTH_TRUST_HOST=true`, or Auth.js's separate
   host-trust check rejects every request with `UntrustedHost`. On Vercel
   this is still required and is listed in `VERCEL.md`.
