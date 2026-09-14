<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Deployment

Production is **Vercel** — `https://railserve.vercel.app`, auto-deployed on
every push to `main`. The database is MongoDB Atlas (`railserve`; local and
staging use `railserve_dev`).

`https://bitestation.elvo.in` is **not** production. It is a stale, self-hosted
copy on the cron VPS (nginx -> Docker), left over from an unfinished migration,
several commits behind `main` and backed by its own local Mongo rather than
Atlas. Don't point anything new at it and don't treat what it serves as current
behaviour — including the `SERVER_URL` in the KOT print-agent docs.

Cron is not Vercel Cron — Hobby allows one invocation a day, so an external VPS
curls `/api/cron/*` on a real schedule.

Read `docs/DEPLOY.md` before answering anything about where this runs or
changing deploy config. Hosts and keys are in `docs/INFRA.local.md`, which is
gitignored — this repo is public.
