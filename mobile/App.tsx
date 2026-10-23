import React, { useCallback, useEffect, useState } from 'react'
import { Alert, AppState, BackHandler, Pressable, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { LogOut } from 'lucide-react-native'
import { isRunningInExpoGo } from 'expo'
import * as Device from 'expo-device'
import {
  flushQueue, fetchHistory, fetchRuns, newClientId, queueAndFlush, queueManyAndFlush, registerPushToken,
  ApiError, OfflineError, type Rejected,
} from './src/api'
import {
  cacheRuns, clearSession, loadCachedRuns, loadQueue, loadSession, type StoredUser,
} from './src/storage'
import type { HistoryOrder, HistoryQuery, HistoryResponse, Outcome, RunOrder, RunsResponse } from './src/types'
import { LoginScreen } from './src/screens/Login'
import { HomeScreen } from './src/screens/Home'
import { DeliveryScreen } from './src/screens/Delivery'
import { DeliveryTabScreen } from './src/screens/DeliveryTab'
import { HistoryScreen } from './src/screens/History'
import { ProfileModal } from './src/screens/ProfileModal'
import { C, EnvBanner, TabBar } from './src/ui'
import { IS_NOT_PRODUCTION } from './src/config'
import { flushNow, startSharing, stopSharing } from './src/location'

type Screen = { name: 'home' } | { name: 'delivery'; runKey: string; orderId: string }

/**
 * Say out loud what the server refused for good. The queue drops these, so
 * without a word the rider's tap simply un-happens — most often a pickup
 * another rider got to first.
 */
function announceRejected(rejected: Rejected[]) {
  if (rejected.length === 0) return
  const pickups = rejected.filter((r) => r.kind === 'DISPATCH_ORDER')
  const others = rejected.filter((r) => r.kind !== 'DISPATCH_ORDER')
  const lines = [
    ...(pickups.length
      ? [pickups.length === 1
        ? pickups[0].error
        : `${pickups.length} orders were already picked up by another rider.`]
      : []),
    ...others.map((r) => r.error),
  ]
  Alert.alert(pickups.length && !others.length ? 'Already taken' : 'Not saved', [...new Set(lines)].join('\n\n'))
}

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
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [historyQuery, setHistoryQuery] = useState<HistoryQuery>({})
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

  const loadHistory = useCallback(async (t: string, query: HistoryQuery) => {
    setHistoryLoading(true)
    try {
      setHistory(await fetchHistory(t, query))
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
        announceRejected(r.rejected)
        if (r.synced > 0 || r.rejected.length > 0) await refresh(t, false)
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

  // --- location sharing ---------------------------------------------------
  // Runs for as long as there is a session, and stops the moment there isn't.
  // Not tied to a screen: the rider is on a platform with the delivery screen
  // open exactly when the office most wants to know where they are.
  useEffect(() => {
    if (!token) {
      void stopSharing()
      return
    }
    // Sharing is shown by the ongoing Android notification, not on screen.
    void startSharing(token)

    // Coming back to the foreground is when a phone that was inside a station
    // gets signal again — send what buffered rather than waiting a tick.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushNow(token)
    })

    return () => {
      sub.remove()
      void stopSharing()
    }
  }, [token])

  // --- push registration --------------------------------------------------
  useEffect(() => {
    if (!token) return
      ; (async () => {
        try {
          // Importing expo-notifications at all throws in Expo Go on Android
          // (remote push was removed from Expo Go in SDK 53), so it is loaded
          // here, and only in a real build.
          if (!Device.isDevice || isRunningInExpoGo()) return
          const Notifications: typeof import('expo-notifications') = require('expo-notifications')
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
   * The rider has collected orders the office assigned to them.
   *
   * Applied locally first so the list reflects it even with no signal — the
   * queue carries it to the server whenever that returns.
   */
  async function takeOrders(orderIds: string[]) {
    if (!token || orderIds.length === 0) return
    setBusy(true)
    // Stay on the list while there is more to collect; move to deliveries once
    // the last ready order is in hand.
    const moreReady = (data?.runs ?? []).some((r) =>
      // Open orders nobody was given do not count: they are anyone's to take,
      // not this rider's work still waiting.
      r.orders.some((o) => o.status === 'PREPARED' && o.assignedToMe !== false && !orderIds.includes(o.id)),
    )
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
    announceRejected(r.rejected)
    if (!r.offline) await refresh(token, false)
    setBusy(false)
    // Only move on if the pickup actually went through.
    if (!moreReady && r.rejected.length === 0) setTab('delivery')
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
    announceRejected(r.rejected)
    if (!r.offline) void loadHistory(token, historyQuery)
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
    announceRejected(r.rejected)
    if (!r.offline) void loadHistory(token, historyQuery)
  }

  /**
   * The rider changes how a finished order ended, within its 30 hours.
   * Applied to the list at once and queued like any other write.
   */
  async function correct(o: HistoryOrder, to: Outcome, reason: string | null) {
    if (!token) return
    setBusy(true)
    setHistory((prev) =>
      prev
        ? {
          ...prev,
          orders: prev.orders.map((h) =>
            h.id === o.id
              ? {
                ...h,
                status: to,
                failureReason: to === 'DELIVERED' ? null : reason,
                amountCollectedPaise:
                  to === 'DELIVERED' && h.paymentMode === 'COD' ? h.amountPaise : null,
              }
              : h,
          ),
        }
        : prev,
    )
    try {
      const r = await queueAndFlush(token, {
        kind: 'CORRECT_ORDER', clientId: newClientId(), orderId: o.id,
        from: o.status, to, reason, at: new Date().toISOString(),
      })
      setQueueSize(r.remaining)
      setOffline(r.offline)
      announceRejected(r.rejected)
      if (!r.offline) void loadHistory(token, historyQuery)
    } catch {
      // Queued either way; the 30-second sync carries it when it can.
    } finally {
      setBusy(false)
    }
  }

  // --- render -------------------------------------------------------------
  if (booting) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} />
  }

  if (!token || !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="dark" />
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
      <StatusBar style="dark" />
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
          data={history}
          query={historyQuery}
          onQueryChange={(q) => {
            setHistoryQuery(q)
            if (token) void loadHistory(token, q)
          }}
          refreshing={historyLoading}
          busy={busy}
          onCorrect={(o, to, reason) => void correct(o, to, reason)}
          onRefresh={() => {
            if (token) {
              void sync(token)
              void loadHistory(token, historyQuery)
            }
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
          onPickUp={(orderIds) => void takeOrders(orderIds)}
        />
      )}

      {/* Hidden during a delivery: that screen is one job with one action, and
          a nav bar there is an invitation to walk away from it half-done. */}
      {screen.name === 'home' ? (
        <TabBar
          tab={tab}
          onChange={(t) => {
            setTab(t)
            if (t === 'done' && token) void loadHistory(token, historyQuery)
          }}
        />
      ) : null}

      <ProfileModal
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        user={user}
        stationCode={data?.runs[0]?.stationCode}
        serviceDate={data?.serviceDate}
        history={history?.orders ?? []}
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
