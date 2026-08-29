# Deploying to Vercel

## Environment variables

Set these in **Project → Settings → Environment Variables**. Everything except
the first three is optional — the app degrades honestly without them.

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | **yes** | Atlas SRV string, **with a database name** — `.../railserve?retryWrites=true&w=majority`. Without one the driver silently uses `test`. |
| `AUTH_SECRET` | **yes** | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_TRUST_HOST` | **yes** | Set to `true`. Auth.js refuses every request with `UntrustedHost` otherwise, and it fails at runtime, not at build. |
| `SEED_PASSWORD` | no | Only used by the seed script; irrelevant in production. |
| `CRON_TOKEN` | recommended | Shared secret for `/api/cron/train-poll`. Leave unset and the endpoint is open. |
| `TRAIN_API_PROVIDER` | no | `simulator` (default) or `rapidapi`. |
| `TRAIN_API_KEY` / `TRAIN_API_HOST` | no | Host must be `indian-railway-irctc.p.rapidapi.com` — the adapter maps that product's exact fields. |
| `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | no | Delivery photo storage. All blank ⇒ photo capture does not appear and delivery still works. |
| `GMAIL_*` | no | Email ingestion. All blank ⇒ orders are pasted or entered by hand. |
| `DISPATCH_BUFFER_MINUTES` / `KOT_DELAY_THRESHOLD_MINUTES` | no | Defaults 5 and 45. |

**Do not set `BASE_PATH`.** It exists for an nginx sub-path deployment and, on
Vercel, would move the whole app under a prefix that nothing links to.

`MONGODB_URI_TEST` is a local-only concern — the test suite reads it, Vercel
never does. Leave it out.

## Atlas

Vercel's egress IPs are dynamic, so **Network Access must be `0.0.0.0/0`**
unless you are on a plan with static IPs or PrivateLink. That is normal for
Vercel + Atlas; the database password is the real boundary, so make it a strong
one and give the user only `readWrite` on the app database.

Atlas must be a replica set — every status change is a transaction. Any real
Atlas cluster, including M0, already is.

## First deploy

```bash
# once, from your machine, pointed at the production URI
npm run indexes    # explicit index creation; autoIndex is off on purpose
npm run seed       # outlets + staff. Change the passwords immediately after.
```

`npm run build` runs `verify` (lint + typecheck) before `next build`, so a type
error fails the deployment rather than shipping.

## Cron

`vercel.json` schedules `/api/cron/train-poll` every 10 minutes. It refreshes
live train status and fires the leave-now alert.

- **Hobby allows one cron invocation per day.** On Hobby, either accept that or
  drive the endpoint from an external scheduler — it accepts `GET` and `POST`,
  and takes `x-cron-token`, `Authorization: Bearer`, or `?token=`.
- Nothing breaks without it: train times still refresh whenever a page renders.
  Only the leave-now alert, which must fire with no browser open, is lost.

## Things that behave differently on serverless

**Connection pool.** `src/lib/db.ts` pins `maxPoolSize: 10`. Each warm lambda
holds its own pool, so the driver default of 100 would let a few dozen
instances exhaust a shared-tier cluster's 500-connection limit and lock the app
out of its own database.

**The SSE feed** (`/api/store/stream`) cannot run forever — a function is killed
at its duration cap. It now retires itself at 50 s and lets `EventSource`
reconnect, which is invisible; being cut off mid-write is not. If your plan
allows longer, raise `maxDuration` and `STREAM_LIFETIME_MS` together.

**No background worker.** There is no long-lived process and no Redis. Anything
periodic goes through the cron endpoint above.

## After deploying

1. Sign in and change every seeded password.
2. Rotate the Atlas password if it has ever been pasted into a chat or a shell.
3. Check `/admin` loads and `/api/cron/train-poll` returns `{"ok":true}`.
