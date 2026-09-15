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

Deploying is rsync + rebuild, **not** a git push:

```bash
rsync -az --exclude node_modules --exclude .next --exclude .git \
      --exclude /mobile --exclude '.env*' ./ root@<vps>:/root/railserve/
ssh <vps> 'cd /root/railserve && docker compose -f docker-compose.prod.yml up -d --build app'
```

Code is baked into the image at build time, so a code change needs a
**rebuild**, not a restart. The build needs `DOCKER_BUILD=1`, which switches
`next.config.ts` to `output: 'standalone'` — without it there is no
`.next/standalone` for the Dockerfile to copy and the build fails.

The **Vercel project was deleted on 2026-09-15** — `railserve.vercel.app` 404s
and there is no Vercel fallback. MongoDB Atlas is disconnected but intact:
`railserve` is a frozen pre-migration copy, while `railserve_dev` and
`railserve_test` are **still used** by local dev and the test suite, so the
cluster stays.

Cron and Gmail push both target `bitestation.elvo.in`. Nightly `mongodump`
backups run on the box — self-hosted Mongo has no managed backup behind it.

Read `docs/DEPLOY.md` before changing any deploy config. Hosts and keys are in
`docs/INFRA.local.md`, which is gitignored — this repo is public.
