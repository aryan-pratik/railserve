/**
 * Tells you what is working, what is off, and exactly what to do next.
 *
 *   npm run doctor
 */
import mongoose from 'mongoose'
import { env } from '../src/lib/env'

type Status = 'ok' | 'off' | 'broken'

type Check = {
  name: string
  status: Status
  detail: string
  next?: string[]
}

const ICON: Record<Status, string> = { ok: '✅', off: '⬜', broken: '❌' }

async function checkMongo(): Promise<Check> {
  try {
    const conn = await mongoose.createConnection(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 4000,
    }).asPromise()
    const hello = await conn.db!.admin().command({ hello: 1 })
    const counts = {
      orders: await conn.db!.collection('orders').countDocuments(),
      users: await conn.db!.collection('users').countDocuments(),
      restaurants: await conn.db!.collection('restaurants').countDocuments(),
    }
    await conn.close()

    if (!hello.setName) {
      return {
        name: 'MongoDB',
        status: 'broken',
        detail: 'connected, but NOT a replica set — every status change will fail',
        next: ['docker compose up -d'],
      }
    }
    return {
      name: 'MongoDB',
      status: 'ok',
      detail: `replica set ${hello.setName} · ${counts.restaurants} outlets, ${counts.users} users, ${counts.orders} orders`,
      next: counts.users === 0 ? ['npm run seed'] : undefined,
    }
  } catch (err) {
    return {
      name: 'MongoDB',
      status: 'broken',
      detail: err instanceof Error ? err.message : 'could not connect',
      next: ['docker compose up -d'],
    }
  }
}

function checkTrain(): Check {
  if (env.TRAIN_API_PROVIDER === 'simulator' || !env.TRAIN_API_KEY) {
    return {
      name: 'Live train status',
      status: 'off',
      detail: 'using the built-in simulator — realistic, deterministic, and clearly labelled in the UI',
      next: [
        'Optional. To use real data, in .env.local set:',
        '  TRAIN_API_PROVIDER="rapidapi"',
        '  TRAIN_API_KEY="<your RapidAPI key>"',
        '  TRAIN_API_HOST="<your provider host>"',
      ],
    }
  }
  return {
    name: 'Live train status',
    status: 'ok',
    detail: `live upstream via ${env.TRAIN_API_HOST}`,
  }
}

function checkGmail(): Check {
  const has = {
    id: Boolean(env.GMAIL_CLIENT_ID),
    secret: Boolean(env.GMAIL_CLIENT_SECRET),
    refresh: Boolean(env.GMAIL_REFRESH_TOKEN),
  }
  const missing = Object.entries(has).filter(([, v]) => !v).map(([k]) => k)

  if (missing.length === 3) {
    return {
      name: 'Gmail ingestion',
      status: 'off',
      detail: 'manual ingestion works now — paste an aggregator email at /admin/inbox',
      next: [
        'Optional. To ingest from a real inbox:',
        '  1. npm run gmail:setup    (walks you through it)',
        '  2. Point a scheduler at POST /api/cron/gmail-sync every few minutes',
      ],
    }
  }
  if (missing.length > 0) {
    return {
      name: 'Gmail ingestion',
      status: 'broken',
      detail: `half configured — missing ${missing.join(', ')}`,
      next: ['npm run gmail:setup'],
    }
  }
  return {
    name: 'Gmail ingestion',
    status: 'ok',
    detail: `credentials set for ${env.GMAIL_USER_ID} — polled via /api/cron/gmail-sync`,
    next: env.CRON_TOKEN
      ? undefined
      : ['CRON_TOKEN is unset — /api/cron/gmail-sync accepts unauthenticated calls'],
  }
}

function checkPush(): Check {
  return {
    name: 'Push notifications',
    status: 'off',
    detail: 'device tokens are registered, but sending is not implemented yet',
    next: [
      'Needs a Firebase service account AND code in the worker to send.',
      'Until then the leave-now alert is on the event log and shown live in the app.',
    ],
  }
}

async function main() {
  console.log('\nRailServe — what is running\n')

  const checks: Check[] = [
    await checkMongo(),
    await    checkTrain(),
    checkGmail(),
    checkPush(),
  ]

  for (const c of checks) {
    console.log(`${ICON[c.status]} ${c.name}`)
    console.log(`   ${c.detail}`)
    for (const line of c.next ?? []) console.log(`   → ${line}`)
    console.log()
  }

  const broken = checks.filter((c) => c.status === 'broken')
  if (broken.length === 0) {
    console.log('Nothing is broken. Anything marked ⬜ is optional and has a working local substitute.\n')
  } else {
    console.log(`${broken.length} thing(s) need attention above.\n`)
  }

  process.exit(broken.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('doctor failed:', err)
  process.exit(1)
})
