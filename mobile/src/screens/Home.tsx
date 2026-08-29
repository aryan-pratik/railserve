import React, { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import type { Run, RunOrder } from '../types'
import { Button, C, Card, Check, Person, Rule, Seat, s, timeIST, untilLabel, delayLabel } from '../ui'

/**
 * The rider's work.
 *
 * Two questions, in the order they are actually asked: what do I deliver right
 * now, and what do I pick up next. That is the rider's own mental model — the
 * run/order hierarchy the API returns is a warehouse concept, and making
 * someone navigate it to find their next job is work the screen should do.
 *
 * Pickup is grouped by train because a rider collects a whole train's food in
 * one trip, and sending two riders to one train is wasted effort. But a train
 * can have forty orders and a rider can carry ten, so the group is a set of
 * tick boxes, not a single button: they take what fits and leave the rest for
 * the next person. Delivery is flat, because at the platform each seat is its
 * own job at its own door.
 */
export function HomeScreen({
  runs,
  onTake,
  onReturn,
  onOpenOrder,
  refreshing,
  onRefresh,
  busy,
}: {
  runs: Run[]
  onTake: (orderIds: string[]) => void
  onReturn: (orderId: string) => void
  onOpenOrder: (order: RunOrder, run: Run) => void
  refreshing: boolean
  onRefresh: () => void
  busy: boolean
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // Ready at the counter, nobody has taken it yet.
  const toPickUp = runs
    .map((r) => ({ run: r, orders: r.orders.filter((o) => o.status === 'PREPARED') }))
    .filter((g) => g.orders.length > 0)

  // In this rider's hands right now.
  const toDeliver = runs.flatMap((r) =>
    r.orders.filter((o) => o.status === 'DISPATCHED').map((o) => ({ order: o, run: r })),
  )

  // Still cooking — shown small, so the rider knows more is coming and does not
  // walk away, but it is not work they can act on.
  const cooking = runs.reduce(
    (n, r) => n + r.orders.filter((o) => ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED'].includes(o.status)).length,
    0,
  )

  // Selection is reconciled against what is actually on screen rather than
  // trimmed in an effect: another rider may have taken an order since it was
  // ticked, and submitting a stale id would fail the whole batch.
  const available = new Set(toPickUp.flatMap((g) => g.orders.map((o) => o.id)))
  const selected = [...picked].filter((id) => available.has(id))

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll(ids: string[], allOn: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const nothing = toPickUp.length === 0 && toDeliver.length === 0

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 24,
          paddingBottom: selected.length > 0 ? 120 : 48,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {nothing ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}>
            <Text style={s.h2}>Nothing to do yet</Text>
            <Text style={[s.muted, { marginTop: 8, textAlign: 'center' }]}>
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
              const delay = delayLabel(run.timing.delayMinutes)
              return (
                <Card key={order.id}>
                  <Pressable
                    onPress={() => onOpenOrder(order, run)}
                    accessibilityRole="button"
                    accessibilityLabel={`Deliver to coach ${order.coach ?? 'unknown'} berth ${order.berth ?? ''}, ${order.contactName ?? 'no name'}`}
                    style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={[s.row, { justifyContent: 'space-between', alignItems: 'baseline' }]}>
                      <Seat coach={order.coach} berth={order.berth} />
                      <Text style={{
                        fontSize: 15,
                        fontWeight: until.urgent ? '700' : '500',
                        color: until.urgent ? C.red : C.muted,
                      }}>
                        {until.text}
                      </Text>
                    </View>

                    {/* Which train, by name. A rider works several at once and
                        a number alone is not what is called on a platform. */}
                    <Text style={{ fontSize: 15, color: C.ink, marginTop: 14 }} numberOfLines={1}>
                      {run.trainNo} · {run.trainName ?? 'Train name not known'}
                    </Text>
                    <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
                      {timeIST(run.timing.effectiveArrival)}
                      {run.timing.platform ? `   ·   Platform ${run.timing.platform}` : ''}
                      {delay && delay !== 'On time' ? `   ·   ${delay}` : ''}
                    </Text>

                    <Rule style={{ marginVertical: 16 }} />

                    <Person name={order.contactName} phone={order.contactPhone} />

                    <Rule style={{ marginVertical: 16 }} />

                    <View style={[s.row, { justifyContent: 'space-between' }]}>
                      <Text style={{ fontSize: 14, color: C.muted }}>
                        {order.handoverPoint
                          ? `Hand over at ${order.handoverPoint}`
                          : `${order.items.filter((i) => !i.isPacking).length} item${order.items.filter((i) => !i.isPacking).length === 1 ? '' : 's'}`}
                      </Text>
                      <Text style={{
                        fontSize: 15, fontWeight: '700',
                        color: order.paymentMode === 'COD' ? C.amber : C.green,
                      }}>
                        {order.paymentMode === 'COD'
                          ? `₹${order.amountPaise === null ? '?' : Math.round(order.amountPaise / 100)} cash`
                          : 'Paid'}
                      </Text>
                    </View>
                  </Pressable>

                  {/* Taking an order is one tap and gets mistapped. This is the
                      way back, kept quiet so it is not the thing hit next. */}
                  <Pressable
                    onPress={() => onReturn(order.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Put this order back at the shop"
                    hitSlop={10}
                    style={({ pressed }) => [{
                      alignSelf: 'flex-start', marginTop: 16, opacity: pressed ? 0.5 : 1,
                    }]}
                  >
                    <Text style={{ fontSize: 13, color: C.faint }}>
                      Took by mistake? Put back
                    </Text>
                  </Pressable>
                </Card>
              )
            })}
          </>
        ) : null}

        {toPickUp.length > 0 ? (
          <>
            <Text style={[s.sectionLabel, { marginTop: toDeliver.length > 0 ? 30 : 0, marginBottom: 6 }]}>
              PICK UP FROM SHOP
            </Text>
            <Text style={[s.muted, { marginBottom: 18 }]}>
              Tick the ones you are taking. Leave the rest for another rider.
            </Text>

            {toPickUp.map(({ run, orders }) => {
              const until = untilLabel(run.timing.effectiveArrival)
              const delay = delayLabel(run.timing.delayMinutes)
              const ids = orders.map((o) => o.id)
              const allOn = ids.every((id) => picked.has(id))
              const someOn = ids.filter((id) => picked.has(id)).length

              return (
                <Card key={run.key} style={{ padding: 0 }}>
                  <View style={{ padding: 18 }}>
                    <View style={[s.row, { justifyContent: 'space-between', alignItems: 'baseline' }]}>
                      <Text style={s.train} numberOfLines={1}>
                        {run.trainNo ?? '—'}
                      </Text>
                      <Text style={{
                        fontSize: 15,
                        fontWeight: until.urgent ? '700' : '500',
                        color: until.urgent ? C.red : C.muted,
                      }}>
                        {until.text}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 15, color: C.ink, marginTop: 4 }} numberOfLines={1}>
                      {run.trainName}
                    </Text>
                    <Text style={{ fontSize: 14, color: C.muted, marginTop: 6 }}>
                      {timeIST(run.timing.effectiveArrival)}
                      {run.timing.platform ? `   ·   Platform ${run.timing.platform}` : ''}
                      {delay && delay !== 'On time' ? `   ·   ${delay}` : ''}
                      {`   ·   ${orders.length} waiting`}
                    </Text>

                    {/* Take-all sits with the train, because taking the whole
                        train is the common case on a small order count. */}
                    <Pressable
                      onPress={() => toggleAll(ids, allOn)}
                      accessibilityRole="button"
                      accessibilityLabel={allOn ? 'Clear this train' : 'Select every order on this train'}
                      hitSlop={10}
                      style={({ pressed }) => [{ marginTop: 14, opacity: pressed ? 0.5 : 1 }]}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '700', color: C.accent }}>
                        {allOn ? 'Clear all' : `Select all ${orders.length}`}
                        {!allOn && someOn > 0 ? `   ·   ${someOn} ticked` : ''}
                      </Text>
                    </Pressable>
                  </View>

                  {orders.map((o) => {
                    const on = picked.has(o.id)
                    return (
                      <View key={o.id}>
                        <Rule />
                        <Pressable
                          onPress={() => toggle(o.id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`Coach ${o.coach ?? 'unknown'} berth ${o.berth ?? ''}, ${o.contactName ?? 'no name'}`}
                          style={({ pressed }) => [
                            s.row,
                            {
                              alignItems: 'flex-start',
                              gap: 14,
                              paddingVertical: 16,
                              paddingHorizontal: 18,
                              backgroundColor: on ? C.subtle : 'transparent',
                              opacity: pressed ? 0.6 : 1,
                            },
                          ]}
                        >
                          <View style={{ paddingTop: 3 }}>
                            <Check on={on} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'baseline' }]}>
                              <Seat coach={o.coach} berth={o.berth} />
                              <Text style={{
                                fontSize: 14, fontWeight: '700',
                                color: o.paymentMode === 'COD' ? C.amber : C.green,
                              }}>
                                {o.paymentMode === 'COD'
                                  ? `₹${o.amountPaise === null ? '?' : Math.round(o.amountPaise / 100)}`
                                  : 'Paid'}
                              </Text>
                            </View>
                            <View style={{ marginTop: 12 }}>
                              <Person name={o.contactName} phone={o.contactPhone} compact />
                            </View>
                          </View>
                        </Pressable>
                      </View>
                    )
                  })}
                </Card>
              )
            })}
          </>
        ) : null}

        {cooking > 0 && !nothing ? (
          <Text style={[s.muted, { textAlign: 'center', marginTop: 24 }]}>
            {cooking} more still being cooked
          </Text>
        ) : null}
      </ScrollView>

      {/* The action follows the selection, pinned so it is reachable however
          far down the list the rider has scrolled. */}
      {selected.length > 0 ? (
        <View style={s2.bar}>
          <Button
            label={`Picked up ${selected.length} order${selected.length === 1 ? '' : 's'}`}
            tone="success"
            size="hero"
            busy={busy}
            onPress={() => {
              onTake(selected)
              setPicked(new Set())
            }}
          />
        </View>
      ) : null}
    </View>
  )
}

const s2 = {
  bar: {
    position: 'absolute' as const,
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
}
