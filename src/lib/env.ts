import { z } from 'zod'

/**
 * Validated process environment.
 *
 * Parsed once at module load so a missing or malformed variable fails loudly
 * at boot rather than at the first request that happens to need it.
 */
const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  SEED_PASSWORD: z.string().min(1).default('password'),

  REDIS_URL: z.string().min(1).default('redis://localhost:6380'),

  // Live train status. Defaults to the simulator so the app runs with no
  // third-party account; setting a key is the whole switch to real data.
  TRAIN_API_PROVIDER: z.enum(['simulator', 'rapidapi']).default('simulator'),
  TRAIN_API_KEY: z.string().default(''),
  TRAIN_API_HOST: z.string().default('indianrailapi.p.rapidapi.com'),

  // Gmail ingestion. All blank means the transport is off and ingestion is
  // manual; the parsers and the unparsed inbox work either way.
  GMAIL_CLIENT_ID: z.string().default(''),
  GMAIL_CLIENT_SECRET: z.string().default(''),
  GMAIL_REFRESH_TOKEN: z.string().default(''),
  GMAIL_TOPIC_NAME: z.string().default(''),
  GMAIL_USER_ID: z.string().default('me'),
  GMAIL_WEBHOOK_TOKEN: z.string().default(''),
  INGEST_STALE_ALERT_HOURS: z.coerce.number().int().min(1).default(6),

  DISPATCH_BUFFER_MINUTES: z.coerce.number().int().min(0).default(5),
  KOT_DELAY_THRESHOLD_MINUTES: z.coerce.number().int().min(0).default(45),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\n` +
      'Copy .env.example to .env.local and fill it in.',
  )
}

export const env = parsed.data
