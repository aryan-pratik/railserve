import mongoose from 'mongoose'
import { env } from './env'

/**
 * Cached connection. Next.js dev hot-reloads modules on every edit; without
 * this the process would open a new connection pool per reload until Mongo
 * refuses them.
 */
type Cache = {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

const globalForMongoose = globalThis as unknown as { __railserveMongoose?: Cache }

const cached: Cache = globalForMongoose.__railserveMongoose ?? { conn: null, promise: null }
globalForMongoose.__railserveMongoose = cached

/**
 * Fail loudly if Mongo is not a replica set.
 *
 * Plan §13.1: transactions throw at *runtime*, not at startup, on a standalone
 * mongod. Every status change goes through a transaction, so a standalone
 * server produces an app that boots fine and then breaks the moment someone
 * clicks Accept. Better to refuse to start.
 */
async function assertReplicaSet(m: typeof mongoose): Promise<void> {
  const db = m.connection.db
  if (!db) throw new Error('Mongo connection established but no database handle')

  const hello = await db.admin().command({ hello: 1 })

  if (!hello.setName) {
    throw new Error(
      'MongoDB is NOT running as a replica set.\n\n' +
        'transitionOrder() wraps every status change in a transaction, and\n' +
        'transactions require a replica set. A standalone mongod will fail at\n' +
        'runtime on the first status change, not here.\n\n' +
        'Local dev:  docker compose up -d\n' +
        'Atlas:      replica set by default; check your connection string.',
    )
  }
}

export async function connectDb(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(env.MONGODB_URI, {
        // Indexes are created by `npm run indexes`, never implicitly. Plan §3:
        // "create all of these explicitly, do not rely on Mongoose autoIndex".
        autoIndex: false,
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000,
        // Serverless multiplies this. Every warm Vercel lambda holds its own
        // pool, so the driver default of 100 means a few dozen concurrent
        // instances can exhaust an Atlas cluster's connection limit (500 on
        // the shared tiers) and start refusing the app's own queries. Ten is
        // ample for a request that makes a handful of reads.
        maxPoolSize: 10,
        // Hand idle sockets back rather than holding them for a lambda that
        // may never be invoked again.
        minPoolSize: 0,
        maxIdleTimeMS: 30_000,
      })
      .then(async (m) => {
        await assertReplicaSet(m)
        return m
      })
      .catch((err) => {
        // Reset so the next call retries rather than reusing a rejected promise.
        cached.promise = null
        throw err
      })
  }

  cached.conn = await cached.promise
  return cached.conn
}

export async function disconnectDb(): Promise<void> {
  if (cached.conn) {
    await cached.conn.disconnect()
    cached.conn = null
    cached.promise = null
  }
}
