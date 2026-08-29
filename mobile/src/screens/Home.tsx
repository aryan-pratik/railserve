import React from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import type { Run, RunOrder } from '../types'
import { Button, C, Card, Seat, s, timeIST, untilLabel, delayLabel } from '../ui'

/**
 * The rider's home screen.
 *
 * Two questions, in the order they are actually asked: what do I pick up, and
 * what do I deliver. That is the rider's own mental model — the run/order
 * hierarchy the API returns is a warehouse concept, and making someone
 * navigate it to find their next job is work that the screen should do for
 * them.
 *
 * Pickup is grouped by train because a rider collects a whole train's food in
 * one trip. Delivery is flat, because at the platform each order is its own
 * job at its own door.
 */
export function HomeScreen({
  runs,
  onPickUp,
  onOpenOrder,
  refreshing,
  onRefresh,
  busyRunKey,
}: {
  runs: Run[]
  onPickUp: (runKey: string) => void
  onOpenOrder: (order: RunOrder, run: Run) => void
  refreshing: boolean
  onRefresh: () => void
  busyRunKey: string | null
}) {
  // Ready at the counter, nobody has taken it yet.
  const toPickUp = runs
    .map((r) => ({ run: r, orders: r.orders.filter((o) => o.status === 'PREPARED') }))
    .filter((g) => g.orders.length > 0)

  // In the rider's hands right now.
  const toDeliver = runs.flatMap((r) =>
    r.orders.filter((o) => o.status === 'DISPATCHED').map((o) => ({ order: o, run: r })),
  )

  // Still cooking — shown small, so the rider knows more is coming and does not
  // walk away, but it is not work they can act on.
  const cooking = runs.reduce(
    (n, r) => n + r.orders.filter((o) => ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED'].includes(o.status)).length,
    0,
  )

  const nothing = toPickUp.length === 0 && toDeliver.length === 0

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {nothing ? (
        <View style={{ alignItems: 'center', paddingVertical: 60 }}>
          <Text style={{ fontSize: 52 }}>☕</Text>
          <Text style={[s.h2, { marginTop: 14, textAlign: 'center' }]}>Nothing to do yet</Text>
          <Text style={[s.muted, { marginTop: 6, textAlign: 'center' }]}>
            {cooking > 0
              ? `${cooking} order${cooking === 1 ? '' : 's'} still being cooked.\nPull down to check again.`
              : 'Pull down to check again.'}
          </Text>
        </View>
      ) : null}

      {toDeliver.length > 0 ? (
        <>
          <Text style={s.sectionLabel}>DELIVER NOW · {toDeliver.length}</Text>
          {toDeliver.map(({ order, run }) => {
            const until = untilLabel(run.timing.effectiveArrival)
            return (
              <Pressable
                key={order.id}
                onPress={() => onOpenOrder(order, run)}
                accessibilityRole="button"
                accessibilityLabel={`Deliver to coach ${order.coach ?? 'unknown'} berth ${order.berth ?? ''}`}
                style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
              >
                <Card style={{ borderColor: until.urgent ? C.red : C.line, borderWidth: until.urgent ? 2 : 1 }}>
                  <View style={[s.row, { justifyContent: 'space-between' }]}>
                    <Seat coach={order.coach} berth={order.berth} />
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{
                        fontSize: 16, fontWeight: '800',
                        color: until.urgent ? C.red : C.muted,
                      }}>
                        {until.text}
                      </Text>
                      <Text style={[s.muted, { fontSize: 13 }]}>
                        {run.trainNo} · {timeIST(run.timing.effectiveArrival)}
                      </Text>
                    </View>
                  </View>

                  <View style={[s.row, { marginTop: 12, justifyContent: 'space-between' }]}>
                    <Text style={[s.muted, { fontSize: 15 }]}>
                      {order.handoverPoint ? 'Handover' : `${order.items.filter((i) => !i.isPacking).length} item(s)`}
                    </Text>
                    {order.paymentMode === 'COD' ? (
                      <Text style={{ color: C.amber, fontWeight: '800', fontSize: 17 }}>
                        ₹{order.amountPaise === null ? '?' : Math.round(order.amountPaise / 100)} cash
                      </Text>
                    ) : (
                      <Text style={{ color: C.green, fontWeight: '700', fontSize: 15 }}>Paid</Text>
                    )}
                  </View>
                </Card>
              </Pressable>
            )
          })}
        </>
      ) : null}

      {toPickUp.length > 0 ? (
        <>
          <Text style={[s.sectionLabel, { marginTop: toDeliver.length > 0 ? 18 : 4 }]}>
            PICK UP FROM SHOP
          </Text>
          {toPickUp.map(({ run, orders }) => {
            const until = untilLabel(run.timing.effectiveArrival)
            const delay = delayLabel(run.timing.delayMinutes)
            return (
              <Card key={run.key}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.train}>{run.trainNo ?? '—'}</Text>
                    <Text style={[s.muted, { marginTop: 2 }]} numberOfLines={1}>
                      {run.trainName}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>
                      {timeIST(run.timing.effectiveArrival)}
                    </Text>
                    <Text style={{
                      fontSize: 13, fontWeight: '700',
                      color: until.urgent ? C.red : C.muted,
                    }}>
                      {until.text}
                    </Text>
                  </View>
                </View>

                <View style={[s.row, { marginTop: 10, flexWrap: 'wrap', gap: 8 }]}>
                  {run.timing.platform ? (
                    <View style={{ backgroundColor: C.ink, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                        Platform {run.timing.platform}
                      </Text>
                    </View>
                  ) : null}
                  {delay && delay !== 'On time' ? (
                    <View style={{ backgroundColor: C.redSoft, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 }}>
                      <Text style={{ color: C.red, fontWeight: '800', fontSize: 14 }}>{delay}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Seats laid out so the rider can see the walk before taking it. */}
                <View style={[s.row, { marginTop: 12, flexWrap: 'wrap', gap: 8 }]}>
                  {orders.map((o) => (
                    <Seat key={o.id} coach={o.coach} berth={o.berth} />
                  ))}
                </View>

                <View style={{ marginTop: 14 }}>
                  <Button
                    label={`Picked up ${orders.length} bag${orders.length === 1 ? '' : 's'}`}
                    icon="✓"
                    tone="success"
                    size="hero"
                    busy={busyRunKey === run.key}
                    onPress={() => onPickUp(run.key)}
                  />
                </View>
              </Card>
            )
          })}
        </>
      ) : null}

      {cooking > 0 && !nothing ? (
        <Text style={[s.muted, { textAlign: 'center', marginTop: 18 }]}>
          {cooking} more still being cooked
        </Text>
      ) : null}
    </ScrollView>
  )
}
