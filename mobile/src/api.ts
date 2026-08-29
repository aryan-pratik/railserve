import { API_URL } from './config'
import { enqueue, loadQueue, removeFromQueue } from './storage'
import type { HistoryResponse, QueuedMutation, RunsResponse } from './types'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Distinguishes "the server said no" from "the phone has no signal". */
export class OfflineError extends Error {
  constructor() {
    super('No connection')
  }
}

async function request<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    // fetch only rejects on a transport failure, which on a platform is
    // almost always no signal rather than a bad request.
    throw new OfflineError()
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status)
  }
  return (await res.json()) as T
}

export async function login(phone: string, password: string) {
  return request<{ token: string; expiresAt: string; user: { id: string; name: string; phone: string } }>(
    '/api/mobile/login',
    null,
    { method: 'POST', body: JSON.stringify({ phone, password }) },
  )
}

export async function fetchRuns(token: string): Promise<RunsResponse> {
  return request<RunsResponse>('/api/mobile/runs', token)
}

/**
 * What this rider has already finished. Deliberately not cached offline: it is
 * a record to look back at, not something needed on a platform with no signal,
 * and caching it would compete for the storage the write queue depends on.
 */
export async function fetchHistory(token: string): Promise<HistoryResponse> {
  return request<HistoryResponse>('/api/mobile/history', token)
}


export async function registerPushToken(token: string, pushToken: string | null) {
  return request<{ ok: boolean }>('/api/mobile/device', token, {
    method: 'POST',
    body: JSON.stringify({ pushToken }),
  })
}

export type FlushResult = { synced: number; failed: number; remaining: number; offline: boolean }

/**
 * Sends the whole queue in one batch and drops everything the server has
 * settled — applied, already-done, or permanently rejected. Only retryable
 * failures stay, so a poison mutation cannot wedge the queue forever.
 */
/**
 * Must match the server's cap on a mutation batch. Sending more than this
 * fails the whole request as malformed, which would strand a queue that grew
 * past it — a rider taking a large train, or one that was offline for a while.
 */
const MAX_BATCH = 100

export async function flushQueue(token: string): Promise<FlushResult> {
  const queue = await loadQueue()
  if (queue.length === 0) return { synced: 0, failed: 0, remaining: 0, offline: false }

  let synced = 0
  let failed = 0

  try {
    for (let i = 0; i < queue.length; i += MAX_BATCH) {
      const res = await request<{
        results: {
          clientId: string
          applied: boolean
          alreadyDone?: boolean
          retryable?: boolean
          error?: string
        }[]
      }>('/api/mobile/mutations', token, {
        method: 'POST',
        body: JSON.stringify({ mutations: queue.slice(i, i + MAX_BATCH) }),
      })

      // Drop per batch rather than at the end, so losing signal halfway
      // through keeps the progress already made.
      const settled = res.results.filter((r) => r.applied || r.retryable === false)
      await removeFromQueue(settled.map((r) => r.clientId))

      synced += res.results.filter((r) => r.applied).length
      failed += res.results.filter((r) => !r.applied).length
    }

    return { synced, failed, remaining: (await loadQueue()).length, offline: false }
  } catch (err) {
    if (err instanceof OfflineError) {
      return { synced, failed, remaining: (await loadQueue()).length, offline: true }
    }
    throw err
  }
}

/** Queue a mutation, then try to send immediately. */
export async function queueAndFlush(
  token: string,
  mutation: QueuedMutation,
): Promise<FlushResult> {
  await enqueue(mutation)
  return flushQueue(token)
}

/**
 * Queue several mutations and send them as one batch.
 *
 * A rider ticking ten orders is one decision, so it should be one request and
 * one failure to reason about — not ten.
 */
export async function queueManyAndFlush(
  token: string,
  mutations: QueuedMutation[],
): Promise<FlushResult> {
  for (const m of mutations) await enqueue(m)
  return flushQueue(token)
}

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
