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


  // Live train status. Defaults to the simulator so the app runs with no
  // third-party account; setting a key is the whole switch to real data.
  TRAIN_API_PROVIDER: z.enum(['simulator', 'rapidapi']).default('simulator'),
  TRAIN_API_KEY: z.string().default(''),
  // Must match the vendor src/lib/train/rapidapi.ts is written against — the
  // adapter maps that product's exact field names and fails closed on anything
  // else, so a different RapidAPI host here means every call fails silently
  // into scheduled times.
  TRAIN_API_HOST: z.string().default('indian-railway-irctc.p.rapidapi.com'),

  // Gmail ingestion. All blank means the transport is off and ingestion is
  // manual; the parsers and the unparsed inbox work either way.
  GMAIL_CLIENT_ID: z.string().default(''),
  GMAIL_CLIENT_SECRET: z.string().default(''),
  GMAIL_REFRESH_TOKEN: z.string().default(''),
  GMAIL_TOPIC_NAME: z.string().default(''),
  GMAIL_USER_ID: z.string().default('me'),
  GMAIL_WEBHOOK_TOKEN: z.string().default(''),
  INGEST_STALE_ALERT_HOURS: z.coerce.number().int().min(1).default(6),

  // Delivery proof photos (Cloudflare R2, S3 API). All blank means photo
  // capture is simply unavailable — proof is optional, so this is a supported
  // configuration rather than a missing one.
  R2_ACCOUNT_ID: z.string().default(''),
  R2_BUCKET: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),

  // Shared secret for /api/cron/train-poll. Blank leaves the endpoint open,
  // which is fine locally and is not fine on a public host.
  CRON_TOKEN: z.string().default(''),

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
