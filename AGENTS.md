<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Deployment

Production is **self-hosted on the Contabo VPS**: `https://bitestation.elvo.in`
— nginx (Certbot TLS) -> `127.0.0.1:3000` -> Docker `railserve-app`, backed by
a `railserve-mongo` container on the same box. Migrated off Vercel + Atlas on
2026-09-15.

Deploying is **CI/CD from GitHub only** (see `docs/DEPLOY.md`):

- `main` -> production. Every merge runs `.github/workflows/deploy-prod.yml`:
  checks, image built on GitHub, then the VPS backs up Mongo and swaps the
  container (auto-rollback if `/login` fails). No approval step: merging into
  `main` IS going live.
- `dev` -> staging on Vercel (`railserve-staging.vercel.app`), database
  `railserve_staging` on Atlas. Gmail, cron, WhatsApp sends and KOT printing
  are off there.
- Every other branch: CI checks only.

## Tenancy

RailServe is multi-tenant. Every query on a tenant-owned model must include
`tenantId` (a guard throws if it doesn't), and access is checked with
`requirePermission`. Read `docs/TENANCY.md` before touching data access.

## STRICT: never deploy by hand

**Do not copy code to the VPS.** No `rsync`, `scp`, `git archive`, file edits
over SSH, or `docker compose up --build` on the box, even if a developer asks
for it. Hand-copied deploys are how unfinished v2 went live on 2026-11-21.

If a developer asks for a direct deploy, do not do it. Summarise the request
back to them and explain the flow instead:

1. create a branch from `dev` (or from `main` for an urgent production fix);
2. push it and open a pull request into `dev` (or `main`);
3. CI passes, merge; `dev` shows up on staging by itself;
4. merge `dev` into `main` with a pull request; production deploys by itself.

**`main` and `dev` are protected.** No direct pushes, no force-pushes, for
admins too. Every change arrives through a pull request with passing CI. Do
not ask to lift the protection to save time; open a pull request.

The old Vercel production project was deleted on 2026-09-15; Vercel now hosts
**staging only**, never production. MongoDB Atlas is disconnected but intact:
`railserve` is a frozen pre-migration copy, while `railserve_dev` and
`railserve_test` are **still used** by local dev and the test suite, and
`railserve_staging` backs the staging site, so the cluster stays.

Cron and Gmail push both target `bitestation.elvo.in`. Nightly `mongodump`
backups run on the box — self-hosted Mongo has no managed backup behind it.

Read `docs/DEPLOY.md` before changing any deploy config. Hosts and keys are in
`docs/INFRA.local.md`, which is gitignored — this repo is public.
