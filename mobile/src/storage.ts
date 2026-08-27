import AsyncStorage from '@react-native-async-storage/async-storage'
import type { QueuedMutation, RunsResponse } from './types'

const K = {
  token: 'railserve.token',
  user: 'railserve.user',
  queue: 'railserve.queue',
  runs: 'railserve.runs',
} as const

export type StoredUser = { id: string; name: string; phone: string }

export async function saveSession(token: string, user: StoredUser) {
  await AsyncStorage.multiSet([
    [K.token, token],
    [K.user, JSON.stringify(user)],
  ])
}

export async function loadSession(): Promise<{ token: string; user: StoredUser } | null> {
  const [[, token], [, user]] = await AsyncStorage.multiGet([K.token, K.user])
  if (!token || !user) return null
  try {
    return { token, user: JSON.parse(user) as StoredUser }
  } catch {
    return null
  }
}

export async function clearSession() {
  // The queue survives sign-out on purpose: unsynced deliveries are the
  // agent's work, and discarding them because a token expired would lose it.
  await AsyncStorage.multiRemove([K.token, K.user, K.runs])
}

/**
 * Last successful runs payload, so the app opens with real content in a station
 * with no signal rather than an empty screen.
 */
export async function cacheRuns(data: RunsResponse) {
  await AsyncStorage.setItem(K.runs, JSON.stringify(data))
}

export async function loadCachedRuns(): Promise<RunsResponse | null> {
  const raw = await AsyncStorage.getItem(K.runs)
  if (!raw) return null
  try {
    return JSON.parse(raw) as RunsResponse
  } catch {
    return null
  }
}

// --- offline write queue ---------------------------------------------------
// Plan §10/§13.10: the delivery app must work with intermittent connectivity —
// queue writes locally and sync. Every mutation is replay-safe server-side, so
// the queue can be aggressive about retrying.

export async function loadQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(K.queue)
  if (!raw) return []
  try {
    return JSON.parse(raw) as QueuedMutation[]
  } catch {
    return []
  }
}

async function writeQueue(items: QueuedMutation[]) {
  await AsyncStorage.setItem(K.queue, JSON.stringify(items))
}

export async function enqueue(mutation: QueuedMutation) {
  const q = await loadQueue()
  q.push(mutation)
  await writeQueue(q)
}

export async function removeFromQueue(clientIds: string[]) {
  if (clientIds.length === 0) return
  const drop = new Set(clientIds)
  await writeQueue((await loadQueue()).filter((m) => !drop.has(m.clientId)))
}
