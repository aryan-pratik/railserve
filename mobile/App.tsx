import React, { useCallback, useEffect, useState } from 'react'
import { AppState, Pressable, SafeAreaView, StatusBar, Text, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { flushQueue, fetchRuns, newClientId, queueAndFlush, registerPushToken, uploadProofPhoto, ApiError, OfflineError } from './src/api'
import {
  cacheRuns, clearSession, loadCachedRuns, loadQueue, loadSession, type StoredUser,
} from './src/storage'
import type { Run, RunOrder, RunsResponse } from './src/types'
import { LoginScreen } from './src/screens/Login'
import { RunsScreen } from './src/screens/Runs'
import { RunDetailScreen } from './src/screens/RunDetail'
import { OrderDetailScreen } from './src/screens/OrderDetail'
import { C, s } from './src/ui'

type Screen =
  | { name: 'runs' }
  | { name: 'run'; runKey: string }
  | { name: 'order'; runKey: string; orderId: string }

export default function App() {
  const [booting, setBooting] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<StoredUser | null>(null)

  const [data, setData] = useState<RunsResponse | null>(null)
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [queueSize, setQueueSize] = useState(0)
  const [screen, setScreen] = useState<Screen>({ name: 'runs' })

  // --- boot ---------------------------------------------------------------
  useEffect(() => {
    ;(async () => {
      const session = await loadSession()
      if (session) {
        setToken(session.token)
        setUser(session.user)
        setData(await loadCachedRuns())
      }
      setQueueSize((await loadQueue()).length)
      setBooting(false)
    })()
  }, [])

  const refresh = useCallback(async (t: string, showSpinner = true) => {
    if (showSpinner) setRefreshing(true)
    try {
      const fresh = await fetchRuns(t)
      setData(fresh)
      await cacheRuns(fresh)
      setOffline(false)
    } catch (err) {
      if (err instanceof OfflineError) {
        setOffline(true)
      } else if (err instanceof ApiError && err.status === 401) {
        await clearSession()
        setToken(null)
        setUser(null)
      }
    } finally {
      setRefreshing(false)
    }
  }, [])

  const sync = useCallback(
    async (t: string) => {
      try {
        const r = await flushQueue(t)
        setQueueSize(r.remaining)
        setOffline(r.offline)
        if (r.synced > 0) await refresh(t, false)
      } catch {
        // Never let a sync failure take the screen down; the next tick retries.
      }
    },
    [refresh],
  )

  // Poll while signed in, and flush the queue whenever the app comes forward —
  // reconnecting after a station is exactly when a phone gets picked up again.
  useEffect(() => {
    if (!token) return
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      void refresh(token, false)
      void sync(token)
    }

    // Deferred rather than called in the effect body: both of these set state,
    // and doing that synchronously on mount cascades an extra render.
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 30_000)

    const sub = AppState.addEventListener('change', (state) => {
      // Coming back to the foreground is exactly when a phone that was in a
      // station regains signal.
      if (state === 'active') tick()
    })

    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(timer)
      sub.remove()
    }
  }, [token, refresh, sync])

  // --- push registration --------------------------------------------------
  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        if (!Device.isDevice) return
        const existing = await Notifications.getPermissionsAsync()
        const status =
          existing.status === 'granted'
            ? existing.status
            : (await Notifications.requestPermissionsAsync()).status
        if (status !== 'granted') return

        const pushToken = (await Notifications.getExpoPushTokenAsync()).data
        await registerPushToken(token, pushToken)
      } catch {
        // Push is a convenience: the leave-now countdown is on screen anyway,
        // and a dev build without FCM credentials will fail here routinely.
      }
    })()
  }, [token])

  // --- actions ------------------------------------------------------------
  const run = data?.runs.find((r) => 'runKey' in screen && r.key === screen.runKey) ?? null
  const order =
    screen.name === 'order' ? (run?.orders.find((o) => o.id === screen.orderId) ?? null) : null

  /**
   * Applies a mutation locally before it reaches the server. Without this a
   * delivery recorded with no signal appears not to have happened, and the
   * agent records it again.
   */
  function applyLocally(orderId: string, patch: Partial<RunOrder>) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            runs: prev.runs.map((r) => ({
              ...r,
              orders: r.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)),
            })),
          }
        : prev,
    )
  }

  async function dispatchRun(runKey: string) {
    if (!token) return
    setBusy(true)
    const r = await queueAndFlush(token, {
      kind: 'DISPATCH_RUN', clientId: newClientId(), runKey, at: new Date().toISOString(),
    })
    setQueueSize(r.remaining)
    setOffline(r.offline)
    setData((prev) =>
      prev
        ? {
            ...prev,
            runs: prev.runs.map((run) =>
              run.key === runKey
                ? {
                    ...run,
                    orders: run.orders.map((o) =>
                      o.status === 'PREPARED' ? { ...o, status: 'DISPATCHED' } : o,
                    ),
                    statusCounts: {
                      ...run.statusCounts,
                      DISPATCHED: (run.statusCounts.DISPATCHED ?? 0) + (run.statusCounts.PREPARED ?? 0),
                      PREPARED: 0,
                    },
                  }
                : run,
            ),
          }
        : prev,
    )
    if (!r.offline) await refresh(token, false)
    setBusy(false)
  }

  /**
   * Uploads a photo and returns its object key.
   *
   * Runs before the delivery is queued, so only the key ever enters the offline
   * queue. Returns null on any failure — proof is optional, and a rider must
   * never be stuck at a door because a photo would not upload.
   */
  async function capturePhoto(orderId: string, localUri: string): Promise<string | null> {
    if (!token) return null
    try {
      return await uploadProofPhoto(token, orderId, localUri)
    } catch {
      return null
    }
  }

  async function deliver(
    orderId: string,
    receivedBy: string,
    amountCollected: string | null,
    proofKey: string | null,
  ) {
    if (!token) return
    setBusy(true)
    applyLocally(orderId, {
      status: 'DELIVERED',
      delivery: {
        deliveredAt: new Date().toISOString(),
        proofValue: proofKey ?? receivedBy,
        amountCollectedPaise: amountCollected ? Math.round(Number(amountCollected) * 100) : null,
        failureReason: null,
      },
    })
    const r = await queueAndFlush(token, {
      kind: 'DELIVER_ORDER', clientId: newClientId(), orderId, receivedBy,
      proofKey, amountCollected, at: new Date().toISOString(),
    })
    setQueueSize(r.remaining)
    setOffline(r.offline)
    setBusy(false)
    setScreen({ name: 'run', runKey: (screen as { runKey: string }).runKey })
  }

  async function fail(orderId: string, failureReason: string) {
    if (!token) return
    setBusy(true)
    applyLocally(orderId, {
      status: 'FAILED',
      delivery: {
        deliveredAt: null, proofValue: null, amountCollectedPaise: null, failureReason,
      },
    })
    const r = await queueAndFlush(token, {
      kind: 'FAIL_ORDER', clientId: newClientId(), orderId, failureReason,
      at: new Date().toISOString(),
    })
    setQueueSize(r.remaining)
    setOffline(r.offline)
    setBusy(false)
    setScreen({ name: 'run', runKey: (screen as { runKey: string }).runKey })
  }

  // --- render -------------------------------------------------------------
  if (booting) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} />
  }

  if (!token || !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar barStyle="dark-content" />
        <LoginScreen
          onDone={(t, u) => {
            setToken(t)
            setUser(u)
          }}
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" />

      <View
        style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          paddingHorizontal: 16, paddingVertical: 10,
          borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: '#fff',
        }}
      >
        <Text style={{ fontWeight: '700', color: C.ink }}>{user.name}</Text>
        <Pressable
          onPress={async () => {
            await clearSession()
            setToken(null)
            setUser(null)
            setScreen({ name: 'runs' })
          }}
          hitSlop={10}
        >
          <Text style={s.muted}>Sign out</Text>
        </Pressable>
      </View>

      {screen.name === 'runs' || !run ? (
        <RunsScreen
          data={data}
          offline={offline}
          refreshing={refreshing}
          queueSize={queueSize}
          onRefresh={() => {
            void refresh(token, true)
            void sync(token)
          }}
          onOpen={(r: Run) => setScreen({ name: 'run', runKey: r.key })}
        />
      ) : screen.name === 'run' ? (
        <RunDetailScreen
          run={run}
          dispatching={busy}
          onBack={() => setScreen({ name: 'runs' })}
          onOpenOrder={(o) => setScreen({ name: 'order', runKey: run.key, orderId: o.id })}
          onDispatch={() => dispatchRun(run.key)}
        />
      ) : order ? (
        <OrderDetailScreen
          order={order}
          busy={busy}
          offline={offline}
          onBack={() => setScreen({ name: 'run', runKey: run.key })}
          onDeliver={(receivedBy, amount, proofKey) =>
            deliver(order.id, receivedBy, amount, proofKey)
          }
          onCapturePhoto={(uri) => capturePhoto(order.id, uri)}
          onFail={(reason) => fail(order.id, reason)}
        />
      ) : (
        <RunDetailScreen
          run={run}
          dispatching={busy}
          onBack={() => setScreen({ name: 'runs' })}
          onOpenOrder={(o) => setScreen({ name: 'order', runKey: run.key, orderId: o.id })}
          onDispatch={() => dispatchRun(run.key)}
        />
      )}
    </SafeAreaView>
  )
}
