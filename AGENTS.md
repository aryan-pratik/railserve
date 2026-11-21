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

Deploying is **CI/CD from GitHub** (see `docs/DEPLOY.md`):

- `main` -> production. `.github/workflows/deploy-prod.yml` runs the checks,
  builds the image on GitHub, then **waits for a manual approval** before it
  backs up Mongo and swaps the container on the VPS (auto-rollback if
  `/login` fails). Merging into `main` is the moment a change goes live.
- `dev` -> staging on Vercel (project `railserve-staging`), database
  `railserve_staging` on Atlas. Staging has Gmail, cron, WhatsApp sends and
  KOT printing switched off.
- Every other branch: CI checks only.

The old rsync + `docker compose up -d --build` path still works as a fallback.
The build needs `DOCKER_BUILD=1`, which switches `next.config.ts` to
`output: 'standalone'`.

The old Vercel production project was deleted on 2026-09-15; Vercel now hosts
**staging only**, never production. MongoDB Atlas is disconnected but intact:
`railserve` is a frozen pre-migration copy, while `railserve_dev` and
`railserve_test` are **still used** by local dev and the test suite, and
`railserve_staging` backs the staging site, so the cluster stays.

Cron and Gmail push both target `bitestation.elvo.in`. Nightly `mongodump`
backups run on the box — self-hosted Mongo has no managed backup behind it.

Read `docs/DEPLOY.md` before changing any deploy config. Hosts and keys are in
`docs/INFRA.local.md`, which is gitignored — this repo is public.
