import React, { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import type { Run, RunOrder } from '../types'
import { Button, C, Card, Check, Money, Person, Pill, Seat, s, timeIST, untilLabel, delayLabel } from '../ui'

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
        contentContainerStyle={{ padding: 16, paddingBottom: selected.length > 0 ? 110 : 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {nothing ? (
          <View style={{ alignItems: 'center', paddingVertical: 70 }}>
            <Text style={[s.h2, { textAlign: 'center' }]}>Nothing to do yet</Text>
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
              const delay = delayLabel(run.timing.delayMinutes)
              return (
                <Card key={order.id}>
                  <Pressable
                    onPress={() => onOpenOrder(order, run)}
                    accessibilityRole="button"
                    accessibilityLabel={`Deliver to coach ${order.coach ?? 'unknown'} berth ${order.berth ?? ''}, ${order.contactName ?? 'no name'}`}
                    style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
                  >
                    <View style={[s.row, { justifyContent: 'space-between' }]}>
                      <Seat coach={order.coach} berth={order.berth} />
                      <Text style={{
                        fontSize: 15, fontWeight: '800',
                        color: until.urgent ? C.red : C.muted,
                      }}>
                        {until.text}
                      </Text>
                    </View>

                    {/* Which train, by name. A rider works several at once and
                        a number alone is not what they are shouted at the
                        platform. */}
                    <Text style={{ fontSize: 15, fontWeight: '700', color: C.ink, marginTop: 10 }}
                      numberOfLines={1}>
                      {run.trainNo} · {run.trainName ?? 'Train name not known'}
                    </Text>
                    <View style={[s.row, { marginTop: 6, flexWrap: 'wrap', gap: 6 }]}>
                      <Pill text={timeIST(run.timing.effectiveArrival)} />
                      {run.timing.platform ? <Pill tone="dark" text={`PF ${run.timing.platform}`} /> : null}
                      {delay && delay !== 'On time' ? <Pill tone="red" text={delay} /> : null}
                    </View>

                    <View style={{ height: 1, backgroundColor: C.line, marginVertical: 11 }} />

                    <Person name={order.contactName} phone={order.contactPhone} />

                    <View style={[s.row, { marginTop: 11, justifyContent: 'space-between' }]}>
                      <Text style={{ fontSize: 13, color: C.muted }}>
                        {order.handoverPoint
                          ? `Hand over at ${order.handoverPoint}`
                          : `${order.items.filter((i) => !i.isPacking).length} item(s)`}
                      </Text>
                      {order.paymentMode === 'COD' ? (
                        <Pill
                          tone="amber"
                          text={`Collect ₹${order.amountPaise === null ? '?' : Math.round(order.amountPaise / 100)}`}
                        />
                      ) : (
                        <Pill tone="green" text="Paid" />
                      )}
                    </View>
                  </Pressable>

                  {/* Taking an order is one tap and gets mistapped. This is the
                      way back, kept small so it is not the thing hit next. */}
                  <Pressable
                    onPress={() => onReturn(order.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Put this order back at the shop"
                    hitSlop={8}
                    style={({ pressed }) => [{
                      alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4,
                      opacity: pressed ? 0.6 : 1,
                    }]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.faint }}>
                      Took it by mistake? Put back
                    </Text>
                  </Pressable>
                </Card>
              )
            })}
          </>
        ) : null}

        {toPickUp.length > 0 ? (
          <>
            <Text style={[s.sectionLabel, { marginTop: toDeliver.length > 0 ? 20 : 4 }]}>
              PICK UP FROM SHOP
            </Text>
            <Text style={[s.muted, { marginTop: -4, marginBottom: 12 }]}>
              Tick the ones you are taking. Leave the rest for another rider.
            </Text>

            {toPickUp.map(({ run, orders }) => {
              const until = untilLabel(run.timing.effectiveArrival)
              const delay = delayLabel(run.timing.delayMinutes)
              const ids = orders.map((o) => o.id)
              const allOn = ids.every((id) => picked.has(id))
              const someOn = ids.filter((id) => picked.has(id)).length

              return (
                <Card key={run.key}>
                  <View style={[s.row, { justifyContent: 'space-between' }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.train}>{run.trainNo ?? '—'}</Text>
                      <Text style={{ fontSize: 14, color: C.muted, marginTop: 2 }} numberOfLines={1}>
                        {run.trainName}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>
                        {timeIST(run.timing.effectiveArrival)}
                      </Text>
                      <Text style={{
                        fontSize: 13, fontWeight: '700', marginTop: 1,
                        color: until.urgent ? C.red : C.faint,
                      }}>
                        {until.text}
                      </Text>
                    </View>
                  </View>

                  <View style={[s.row, { marginTop: 10, flexWrap: 'wrap', gap: 8 }]}>
                    {run.timing.platform ? <Pill tone="dark" text={`Platform ${run.timing.platform}`} /> : null}
                    {delay && delay !== 'On time' ? <Pill tone="red" text={delay} /> : null}
                    <Pill text={`${orders.length} waiting`} />
                  </View>

                  {/* Take-all sits with the train, because taking the whole
                      train is the common case on a small order count. */}
                  <Pressable
                    onPress={() => toggleAll(ids, allOn)}
                    accessibilityRole="button"
                    accessibilityLabel={allOn ? 'Clear this train' : 'Select every order on this train'}
                    hitSlop={8}
                    style={({ pressed }) => [
                      s.row,
                      {
                        marginTop: 14, marginBottom: 4, paddingVertical: 6,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Check on={allOn} />
                    <Text style={{ fontSize: 15, fontWeight: '700', color: allOn ? C.accent : C.muted }}>
                      {allOn ? 'Clear all' : `Take all ${orders.length}`}
                      {!allOn && someOn > 0 ? `  ·  ${someOn} ticked` : ''}
                    </Text>
                  </Pressable>

                  {orders.map((o) => {
                    const on = picked.has(o.id)
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => toggle(o.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`Coach ${o.coach ?? 'unknown'} berth ${o.berth ?? ''}, ${o.contactName ?? 'no name'}`}
                        style={({ pressed }) => [
                          s.row,
                          {
                            alignItems: 'flex-start',
                            gap: 12,
                            paddingVertical: 12,
                            paddingHorizontal: 10,
                            marginTop: 8,
                            borderRadius: 14,
                            backgroundColor: on ? C.accentSoft : C.bg,
                            borderWidth: 2,
                            borderColor: on ? C.accent : 'transparent',
                            opacity: pressed ? 0.85 : 1,
                          },
                        ]}
                      >
                        <View style={{ paddingTop: 2 }}>
                          <Check on={on} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={[s.row, { justifyContent: 'space-between' }]}>
                            <Seat coach={o.coach} berth={o.berth} />
                            {o.paymentMode === 'COD' ? (
                              <Pill
                                tone="amber"
                                text={`₹${o.amountPaise === null ? '?' : Math.round(o.amountPaise / 100)}`}
                              />
                            ) : (
                              <Pill tone="green" text="Paid" />
                            )}
                          </View>
                          <View style={{ marginTop: 10 }}>
                            <Person name={o.contactName} phone={o.contactPhone} compact />
                          </View>
                        </View>
                      </Pressable>
                    )
                  })}
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
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
}
