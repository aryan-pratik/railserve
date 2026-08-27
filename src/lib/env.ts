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
