import React, { useCallback, useEffect, useState } from 'react'
import { AppState, BackHandler, Pressable, StatusBar, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { LogOut } from 'lucide-react-native'
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
import { DeliveryTabScreen } from './src/screens/DeliveryTab'
import { HistoryScreen } from './src/screens/History'
import { ProfileModal } from './src/screens/ProfileModal'
import { C, EnvBanner, TabBar } from './src/ui'
import { IS_NOT_PRODUCTION } from './src/config'

type Screen = { name: 'home' } | { name: 'delivery'; runKey: string; orderId: string }

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  )
}

function AppShell() {
  const [booting, setBooting] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<StoredUser | null>(null)

  const [data, setData] = useState<RunsResponse | null>(null)
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [queueSize, setQueueSize] = useState(0)
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [tab, setTab] = useState<'orders' | 'delivery' | 'done'>('orders')
  const [history, setHistory] = useState<HistoryOrder[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [profileVisible, setProfileVisible] = useState(false)

  // --- boot ---------------------------------------------------------------
  useEffect(() => {
    ; (async () => {
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
      ; (async () => {
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

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (profileVisible) {
        setProfileVisible(false)
        return true
      }
      if (screen.name === 'delivery') {
        setScreen({ name: 'home' })
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [profileVisible, screen])

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
    setTab('delivery')
  }

  /**
   * Put an order back on the counter.
   *
   * The rider tapped "picked up" on something they are not carrying. The food
   * has not moved, so the record should not say it has — and the server logs
   * both the take and the return, so this is a correction, not an erasure.
   */
  async function returnOrder(orderId: string) {
    if (!token) return
    setBusy(true)
    applyLocally(orderId, { status: 'PREPARED' })
    const r = await queueAndFlush(token, {
      kind: 'RETURN_ORDER', clientId: newClientId(), orderId, at: new Date().toISOString(),
    })
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

  // --- render -------------------------------------------------------------
  if (booting) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} />
  }

  if (!token || !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar barStyle="dark-content" />
        {IS_NOT_PRODUCTION && <EnvBanner />}
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
      {IS_NOT_PRODUCTION && <EnvBanner />}

      <View
        style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          paddingHorizontal: 16, paddingVertical: 12,
          borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFFFFF',
        }}
      >
        <Pressable
          onPress={() => setProfileVisible(true)}
          style={({ pressed }) => [{
            flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, marginRight: 10,
            opacity: pressed ? 0.7 : 1,
          }]}
        >
          <View style={{
            width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF3FF',
            justifyContent: 'center', alignItems: 'center',
          }}>
            <Text style={{ color: '#2457D6', fontSize: 15, fontWeight: '700' }}>
              {user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#17181C' }} numberOfLines={1}>
              {user.name}
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '400', color: '#686B76', marginTop: 1 }} numberOfLines={1}>
              {user.phone || 'Platform Rider'}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={async () => {
            await clearSession()
            setToken(null)
            setUser(null)
            setScreen({ name: 'home' })
          }}
          hitSlop={10}
          accessibilityLabel="Sign out"
          style={({ pressed }) => [{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 7,
            borderRadius: 8, borderWidth: 1, borderColor: '#FEE2E2',
            backgroundColor: '#FEF2F2',
            opacity: pressed ? 0.6 : 1,
          }]}
        >
          <LogOut size={15} color="#DC2626" />
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
          onRefresh={() => {
            if (token) void loadHistory(token)
          }}
        />
      ) : tab === 'delivery' ? (
        <DeliveryTabScreen
          runs={data?.runs ?? []}
          refreshing={refreshing}
          onRefresh={() => {
            if (token) {
              void refresh(token, true)
              void sync(token)
            }
          }}
          onOpenOrder={(o, r) => setScreen({ name: 'delivery', runKey: r.key, orderId: o.id })}
        />
      ) : (
        <HomeScreen
          runs={data?.runs ?? []}
          refreshing={refreshing}
          busy={busy}
          onRefresh={() => {
            if (token) {
              void refresh(token, true)
              void sync(token)
            }
          }}
          onTake={(orderIds) => void takeOrders(orderIds)}
          onReturn={(orderId) => void returnOrder(orderId)}
          onOpenOrder={(o, r) => setScreen({ name: 'delivery', runKey: r.key, orderId: o.id })}
        />
      )}

      {/* Hidden during a delivery: that screen is one job with one action, and
          a nav bar there is an invitation to walk away from it half-done. */}
      {screen.name === 'home' ? (
        <TabBar
          tab={tab}
          onChange={(t) => {
            setTab(t)
            if (t === 'done' && token) void loadHistory(token)
          }}
        />
      ) : null}

      <ProfileModal
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        user={user}
        stationCode={data?.runs[0]?.stationCode}
        serviceDate={data?.serviceDate}
        history={history}
        offline={offline}
        queueSize={queueSize}
        onSignOut={async () => {
          await clearSession()
          setToken(null)
          setUser(null)
          setScreen({ name: 'home' })
        }}
      />

    </SafeAreaView>
  )
}
