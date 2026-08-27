import React, { useSyncExternalStore } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import type { Run, RunOrder } from '../types'
import { Button, C, Card, Pill, Rupees, delayLabel, s, timeIST } from '../ui'

const TICK = 15_000
const subscribeToClock = (cb: () => void) => {
  const t = setInterval(cb, TICK)
  return () => clearInterval(t)
}
// Bucketed so the snapshot is stable between reads within a tick — returning a
// fresh Date.now() on every read would spin React forever. Reading the clock
// through a store also keeps it out of render, where it is not pure.
const clockSnapshot = () => Math.floor(Date.now() / TICK)

function LeaveNow({ dispatchAt, platform, trainNo, ready }: {
  dispatchAt: string | null
  platform: string | null
  trainNo: string | null
  ready: number
}) {
  const bucket = useSyncExternalStore(subscribeToClock, clockSnapshot, clockSnapshot)

  if (!dispatchAt) {
    return (
      <Card style={{ backgroundColor: C.slateBg }}>
        <Text style={s.muted}>No arrival time known yet, so there is no leave-now time.</Text>
      </Card>
    )
  }

  const minsLeft = Math.round((new Date(dispatchAt).getTime() - bucket * TICK) / 60_000)

  if (minsLeft <= 0) {
    return (
      <Card style={{ backgroundColor: C.red, borderColor: C.red }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' }}>
          LEAVE NOW
        </Text>
        <Text style={{ color: '#fff', textAlign: 'center', marginTop: 4 }}>
          {trainNo} · {ready} order{ready === 1 ? '' : 's'} ·{' '}
          {platform ? `platform ${platform}` : 'platform unknown'}
        </Text>
      </Card>
    )
  }

  const h = Math.floor(minsLeft / 60)
  const m = minsLeft % 60
  const urgent = minsLeft <= 15

  return (
    <Card style={{ backgroundColor: urgent ? C.amberBg : C.slateBg, borderColor: urgent ? '#fcd34d' : C.line }}>
      <Text style={{ textAlign: 'center', fontSize: 12, fontWeight: '700', color: urgent ? C.amber : C.muted }}>
        LEAVE IN
      </Text>
      <Text style={{ textAlign: 'center', fontSize: 28, fontWeight: '800', color: urgent ? C.amber : C.ink }}>
        {h > 0 ? `${h}h ${m}m` : `${m}m`}
      </Text>
      <Text style={{ textAlign: 'center', fontSize: 12, color: urgent ? C.amber : C.muted, marginTop: 2 }}>
        at {timeIST(dispatchAt)} · {platform ? `platform ${platform}` : 'platform unknown'}
      </Text>
    </Card>
  )
}

export function RunDetailScreen({
  run, onBack, onOpenOrder, onDispatch, dispatching,
}: {
  run: Run
  onBack: () => void
  onOpenOrder: (order: RunOrder) => void
  onDispatch: () => void
  dispatching: boolean
}) {
  const ready = run.statusCounts.PREPARED ?? 0
  const delay = delayLabel(run.timing.delayMinutes)

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16 }}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={[s.muted, { marginBottom: 12 }]}>← All runs</Text>
      </Pressable>

      <Card>
        <Text style={{ fontSize: 26, fontWeight: '800', color: C.ink }}>
          {run.trainNo ?? 'No train no.'}
        </Text>
        <Text style={s.muted}>{run.trainName}</Text>

        <View style={[s.row, { marginTop: 10, flexWrap: 'wrap' }]}>
          <Text style={{ fontWeight: '700', fontSize: 16 }}>
            {timeIST(run.timing.effectiveArrival)}
          </Text>
          <Pill
            label={run.timing.source}
            bg={run.timing.source === 'LIVE' ? C.greenBg : C.slateBg}
            fg={run.timing.source === 'LIVE' ? C.green : C.muted}
          />
          {delay ? (
            <Pill label={delay} bg={delay === 'on time' ? C.greenBg : C.amberBg}
              fg={delay === 'on time' ? C.green : C.amber} />
          ) : null}
          {run.timing.stale && run.timing.ageMinutes !== null ? (
            <Pill label={`as of ${run.timing.ageMinutes}m ago`} />
          ) : null}
        </View>
      </Card>

      <LeaveNow
        dispatchAt={run.dispatchAt}
        platform={run.timing.platform}
        trainNo={run.trainNo}
        ready={ready}
      />

      <View style={{ marginBottom: 14 }}>
        <Button
          label={ready === 0 ? 'Nothing ready yet' : `Mark run dispatched (${ready})`}
          onPress={() =>
            Alert.alert('Dispatch run', `Mark ${ready} order(s) as picked up and on the way?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Dispatch', onPress: onDispatch },
            ])
          }
          disabled={ready === 0}
          busy={dispatching}
        />
      </View>

      <Text style={[s.muted, { marginBottom: 8, fontWeight: '700' }]}>
        {run.orders.length} ORDER{run.orders.length === 1 ? '' : 'S'} · WALKING ORDER
      </Text>

      {run.orders.map((o) => {
        const cod = o.paymentMode === 'COD'
        const done = o.status === 'DELIVERED' || o.status === 'FAILED'
        return (
          <Pressable key={o.id} onPress={() => onOpenOrder(o)}>
            <Card style={done ? { opacity: 0.6 } : undefined}>
              <View style={[s.row, { alignItems: 'flex-start' }]}>
                <View>
                  <View style={s.coachBadge}>
                    <Text style={s.coachText}>{o.coach ?? '—'}</Text>
                  </View>
                  {o.berth ? (
                    <Text style={[s.muted, { textAlign: 'center', marginTop: 4, fontSize: 12 }]}>
                      berth {o.berth}
                    </Text>
                  ) : null}
                </View>

                <View style={{ flex: 1 }}>
                  <View style={[s.row, { flexWrap: 'wrap' }]}>
                    <Text style={{ fontWeight: '700', color: C.ink }}>{o.externalOrderId}</Text>
                    <Pill label={o.status.replace('_', ' ')} />
                  </View>
                  <Text style={[s.muted, { marginTop: 3 }]} numberOfLines={1}>
                    {o.orderType === 'BULK'
                      ? `${o.pax} pax · ${o.handoverPoint ?? 'handover'}`
                      : (o.contactName ?? 'Passenger')}
                  </Text>
                  <View style={{ marginTop: 8 }}>
                    {cod ? (
                      <View style={[s.pill, { backgroundColor: C.amberBg, alignSelf: 'flex-start' }]}>
                        <Text style={{ color: C.amber, fontWeight: '800', fontSize: 13 }}>
                          COLLECT <Rupees paise={o.amountPaise} />
                        </Text>
                      </View>
                    ) : (
                      <Pill label="PREPAID" bg={C.slateBg} fg={C.muted} />
                    )}
                  </View>
                </View>
              </View>
            </Card>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
