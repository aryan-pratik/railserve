<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Deployment

Production is **Vercel** — `https://railserve.vercel.app`, auto-deployed on
every push to `main`. The database is MongoDB Atlas (`railserve`; local and
staging use `railserve_dev`).

`https://bitestation.elvo.in` is **not** production. It is a stale copy of the
app on the cron VPS, left over from an abandoned migration, and it is several
commits behind `main` while talking to the live database. Don't point anything
new at it, and don't treat what it serves as current behaviour.

Cron is not Vercel Cron — Hobby allows one invocation a day, so an external VPS
curls `/api/cron/*` on a real schedule.

Read `docs/DEPLOY.md` before answering anything about where this runs or
changing deploy config. Hosts and keys are in `docs/INFRA.local.md`, which is
gitignored — this repo is public.
