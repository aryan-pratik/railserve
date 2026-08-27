import IORedis from 'ioredis'
import { env } from '../env'

/**
 * Shared Redis connection for BullMQ.
 *
 * maxRetriesPerRequest must be null for BullMQ's blocking commands — the
 * default retry cap makes a worker die the first time Redis blips.
 */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  })
}

export const QUEUE_NAMES = {
  trainPolling: 'train-polling',
  gmailWatch: 'gmail-watch',
} as const
