# Deploying to the Azure VM

RailServe runs on the same Azure VM as the `uiis` project (`172.197.160.41`),
under the path prefix **`/railserve`**, sharing nginx's port 8080 — that's
the only port open on the VM's NSG. This is not the only way to deploy this
app (see `docker-compose.yml` + `README.md` for the plain local/any-host
path); this doc is specifically about *this* VM's constraints.

## Why a path prefix, not its own domain

- Only port 8080 is open on the NSG. 80/443 aren't, so there's no way to get
  a real TLS cert; nginx terminates 8080 with the `uiis` project's
  self-signed cert.
- `uiis` already owns the catch-all `server_name _` block on 8080 (`/` →
  its dashboard, `/api/` → its API). Everything for railserve is a single
  added `location /railserve/` in that same file, not a second server block
  — a second `server_name`-based block would need a hostname pointed at
  this VM, which nothing currently provides.
- Consequence: Next's `basePath` is set to `/railserve` at build time (see
  `next.config.ts` — gated on the `BASE_PATH` env var, unset everywhere
  else). **Any change to `next.config.ts` or to the login/logout redirect
  targets needs a rebuild on the VM to take effect** — `BASE_PATH` is
  inlined into the client bundle and into the compiled server actions.

## What's isolated from `uiis`

- **Own Mongo + Redis containers** (`railserve-mongo`, `railserve-redis`),
  bound to `127.0.0.1` only, on the *same* ports the repo's
  `docker-compose.yml` already uses locally (27017, 6380) — just with an
  explicit `127.0.0.1:` prefix added on the VM's copy of that file so they're
  never reachable from outside the box even if the NSG ever changes.
  `uiis`'s own postgres/redis containers are untouched.
- **Own pm2 processes**: `railserve-web` (`next start -p 3001`) and
  `railserve-worker` (`scripts/worker.ts` — train polling, leave-now alerts,
  Gmail watch renewal). Neither touches `uiis`'s pm2/docker processes.
- **nginx**: one added `location /railserve/` block inside the existing
  `/etc/nginx/sites-available/uiis` file (that file is the whole site config
  for port 8080 — there's nowhere else to put it without a second
  `server_name`). `uiis`'s own `location /` and `location /api/` blocks are
  untouched. Before editing, back the file up:
  `sudo cp /etc/nginx/sites-available/uiis /etc/nginx/sites-available/uiis.bak.<date>`,
  then always `sudo nginx -t` before `sudo systemctl reload nginx` (reload,
  not restart — restart would drop `uiis`'s connections too).

## Two things that broke on first deploy — don't reintroduce them

1. **nginx's `$host` variable drops the port.** The `uiis` block's other
   locations use `proxy_set_header Host $host;`, which is fine for them
   (they don't compare Host against Origin). Next's Server Actions CSRF
   check does compare them, and the browser's `Origin` always includes a
   non-default port (`:8080`) while `$host` doesn't — so the check always
   fails. The `/railserve/` location must use
   `proxy_set_header Host $http_host;` instead (`$http_host` preserves the
   port). This is scoped to just that one location block; don't "fix" the
   other two, they don't need it and it's not our config to change.

2. **Auth.js's `redirectTo` doesn't know about `basePath`.** Next's own
   `redirect()` (from `next/navigation`) auto-prepends `basePath` — but
   `signIn(..., { redirectTo })` and `signOut(..., { redirectTo })` are
   Auth.js's own redirect resolution, which is basePath-blind. Left as a
   bare `/`, the post-login redirect sent users to
   `https://<vm-ip>:8080/`, which nginx's default `/` location routes
   straight into `uiis`, not back into railserve. Fixed in
   `src/app/login/actions.ts` and `src/app/actions/session.ts` by building
   the target from `process.env.BASE_PATH` — keep that if either of those
   `signIn`/`signOut` calls changes.

   Also needed: `AUTH_TRUST_HOST=true` in `.env.local` on the VM (not
   needed locally — dev mode trusts the host by default). Without it,
   Auth.js's own separate host-trust check rejects the request with
   `UntrustedHost`.

## Redeploy steps

From the repo root, locally:

```bash
rsync -az -e "ssh -i <key.pem>" \
  --exclude node_modules --exclude .next --exclude /mobile --exclude .git \
  --exclude .env.local --exclude tsconfig.tsbuildinfo \
  ./ azureuser@172.197.160.41:~/railserve/
```

(`--exclude mobile` without the leading `/` also matches `src/lib/mobile/` —
rsync excludes match at any depth. Keep the `/mobile` anchor.)

On the VM:

```bash
cd ~/railserve
npm install                                   # only if package.json changed
NODE_OPTIONS='--max-old-space-size=3072' BASE_PATH=/railserve npx next build
                                               # the VM has 3.8GB RAM; plain
                                               # `npm run build` OOMs during
                                               # typecheck without the bigger
                                               # heap. Lint/typecheck already
                                               # ran locally — this skips
                                               # re-running `verify`.
pm2 restart railserve-web
pm2 restart railserve-worker                  # only if worker code changed
```

nginx only needs touching if the `location /railserve/` block itself
changes (new port, new headers) — not on every code deploy.

## Credentials

Seeded users' shared password is in `~/railserve.credentials.txt` on the VM
(`chmod 600`, not in the repo). Admin: phone `9000000001`.

## URLs

- App: `https://172.197.160.41:8080/railserve/` (self-signed cert — browsers
  will warn; that's inherited from `uiis`'s existing cert setup, not new)
- `uiis` (unaffected): `https://172.197.160.41:8080/`
