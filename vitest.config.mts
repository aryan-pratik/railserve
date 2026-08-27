import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests share one real Mongo (a replica set is required for
    // transactions, so an in-memory standalone would not exercise the code
    // path that matters). Serial execution keeps them from colliding.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      MONGODB_URI:
        process.env.MONGODB_URI_TEST ??
        'mongodb://localhost:27017/railserve_test?replicaSet=rs0',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-secret-at-least-16-chars',
      SEED_PASSWORD: 'password',
      // Pinned regardless of what .env.local has configured for local dev —
      // tests must never depend on network access to a real train API, and
      // must stay deterministic. Without this override a real
      // TRAIN_API_KEY in .env.local silently makes the suite hit the live
      // upstream on every run.
      TRAIN_API_PROVIDER: 'simulator',
      TRAIN_API_KEY: '',
      TRAIN_API_HOST: '',
    },
  },
})
