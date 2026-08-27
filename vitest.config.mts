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
    },
  },
})
