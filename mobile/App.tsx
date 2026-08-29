import React, { useCallback, useEffect, useState } from 'react'
import { AppState, Pressable, SafeAreaView, StatusBar, Text, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { flushQueue, fetchHistory, fetchRuns, newClientId, queueAndFlush, queueManyAndFlush, registerPushToken, ApiError, OfflineError } from './src/api'
import {
  cacheRuns, clearSession, loadCachedRuns, loadQueue, loadSession, type StoredUser,
} from './src/storage'
import type { HistoryOrder, RunOrder, RunsResponse } from './src/types'
import { LoginScreen } from './src/screens/Login'
import { HomeScreen } from './src/screens/Home'
import { DeliveryScreen } from './src/screens/Delivery'
import { HistoryScreen } from './src/screens/History'
import { C, TabBar, s } from './src/ui'

type Screen = { name: 'home' } | { name: 'delivery'; runKey: string; orderId: string }

export default function App() {
  const [booting, setBooting] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<StoredUser | null>(null)

  const [data, setData] = useState<RunsResponse | null>(null)
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [queueSize, setQueueSize] = useState(0)
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [tab, setTab] = useState<'jobs' | 'done'>('jobs')
  const [history, setHistory] = useState<HistoryOrder[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

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

  const loadHistory = useCallback(async (t: string) => {
    setHistoryLoading(true)
    try {
      setHistory((await fetchHistory(t)).orders)
    } catch {
      // A record to look back at is never worth an error screen over the work
      // list; the pull-to-refresh on that tab retries.
    } finally {
      setHistoryLoading(false)
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
    screen.name === 'delivery' ? (run?.orders.find((o) => o.id === screen.orderId) ?? null) : null

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

  /**
   * Take the orders the rider ticked.
   *
   * One batch, because ticking ten boxes was one decision. Applied locally
   * first so the list reflects the choice even with no signal — the queue
   * carries it to the server whenever that returns.
   */
  async function takeOrders(orderIds: string[]) {
    if (!token || orderIds.length === 0) return
    setBusy(true)
    for (const id of orderIds) applyLocally(id, { status: 'DISPATCHED' })

    const at = new Date().toISOString()
    const r = await queueManyAndFlush(
      token,
      orderIds.map((orderId) => ({
        kind: 'DISPATCH_ORDER' as const, clientId: newClientId(), orderId, at,
      })),
    )
    setQueueSize(r.remaining)
    setOffline(r.offline)
    if (!r.offline) await refresh(token, false)
    setBusy(false)
  }

  async function deliver(orderId: string, receivedBy: string, amountCollected: string | null) {
    if (!token) return
    setBusy(true)
    applyLocally(orderId, {
      status: 'DELIVERED',
      delivery: {
        deliveredAt: new Date().toISOString(),
        proofValue: receivedBy,
        amountCollectedPaise: amountCollected ? Math.round(Number(amountCollected) * 100) : null,
        failureReason: null,
      },
    })
    const r = await queueAndFlush(token, {
      kind: 'DELIVER_ORDER', clientId: newClientId(), orderId, receivedBy,
      amountCollected, at: new Date().toISOString(),
    })
    setQueueSize(r.remaining)
    setOffline(r.offline)
    setBusy(false)
    setScreen({ name: 'home' })
    if (!r.offline) void loadHistory(token)
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
    setScreen({ name: 'home' })
    if (!r.offline) void loadHistory(token)
  }

  // Work the rider can act on right now — what the tab badge counts.
  const liveJobs = (data?.runs ?? []).reduce(
    (n, r) => n + r.orders.filter((o) => o.status === 'DISPATCHED' || o.status === 'PREPARED').length,
    0,
  )

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
            setScreen({ name: 'home' })
          }}
          hitSlop={10}
        >
          <Text style={s.muted}>Sign out</Text>
        </Pressable>
      </View>

      {screen.name === 'delivery' && run && order ? (
        <DeliveryScreen
          order={order}
          run={run}
          busy={busy}
          offline={offline}
          onBack={() => setScreen({ name: 'home' })}
          onDeliver={(receivedBy) =>
            deliver(
              order.id,
              receivedBy,
              order.paymentMode === 'COD' && order.amountPaise !== null
                ? (order.amountPaise / 100).toFixed(2)
                : null,
            )
          }
          onFail={(reason) => fail(order.id, reason)}
        />
      ) : tab === 'done' ? (
        <HistoryScreen
          orders={history}
          refreshing={historyLoading}
          onRefresh={() => void loadHistory(token)}
        />
      ) : (
        <HomeScreen
          runs={data?.runs ?? []}
          refreshing={refreshing}
          busy={busy}
          onRefresh={() => {
            void refresh(token, true)
            void sync(token)
          }}
          onTake={(orderIds) => void takeOrders(orderIds)}
          onOpenOrder={(o, r) => setScreen({ name: 'delivery', runKey: r.key, orderId: o.id })}
        />
      )}

      {/* Hidden during a delivery: that screen is one job with one action, and
          a nav bar there is an invitation to walk away from it half-done. */}
      {screen.name === 'home' ? (
        <TabBar
          tab={tab}
          badge={liveJobs}
          onChange={(t) => {
            setTab(t)
            if (t === 'done') void loadHistory(token)
          }}
        />
      ) : null}

    </SafeAreaView>
  )
}
