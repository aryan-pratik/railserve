import React from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import type { HistoryOrder } from '../types'
import { C, Person, Rule, Seat, dateIST, s, timeIST } from '../ui'

/**
 * What this rider has already finished.
 *
 * The work list drops an order the moment it is closed, which is right for
 * getting through a shift and wrong at the end of one: the rider needs to
 * answer "did I deliver that one?" and, more importantly, hand over the right
 * cash. So the cash total is the first thing on the screen — it is the number
 * they are personally accountable for.
 *
 * Grouped by day, newest first, because that is how a shift is remembered.
 */
export function HistoryScreen({
  orders,
  refreshing,
  onRefresh,
}: {
  orders: HistoryOrder[]
  refreshing: boolean
  onRefresh: () => void
}) {
  const delivered = orders.filter((o) => o.status === 'DELIVERED')
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })

  const isToday = (o: HistoryOrder) =>
    o.deliveredAt
      ? new Date(o.deliveredAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === today
      : false

  const cashToday = delivered
    .filter(isToday)
    .reduce((sum, o) => sum + (o.amountCollectedPaise ?? 0), 0)
  const doneToday = delivered.filter(isToday).length

  // Group by calendar day, preserving the server's newest-first order.
  const days: { label: string; items: HistoryOrder[] }[] = []
  for (const o of orders) {
    const label = o.deliveredAt ? dateIST(o.deliveredAt) : 'Earlier'
    const last = days[days.length - 1]
    if (last && last.label === label) last.items.push(o)
    else days.push({ label, items: [o] })
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Cash first. It is the one number the rider is answerable for. */}
      <Text style={s.label}>TODAY</Text>
      <View style={[s.row, { marginTop: 14, gap: 40 }]}>
        <View>
          <Text style={{ fontSize: 30, fontWeight: '800', color: C.ink }}>{doneToday}</Text>
          <Text style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>delivered</Text>
        </View>
        <View>
          <Text style={{ fontSize: 30, fontWeight: '800', color: C.ink }}>
            ₹{Math.round(cashToday / 100)}
          </Text>
          <Text style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>cash collected</Text>
        </View>
      </View>

      <View style={{ height: 28 }} />

      {orders.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 70 }}>
          <Text style={s.h2}>Nothing delivered yet</Text>
          <Text style={[s.muted, { marginTop: 8, textAlign: 'center' }]}>
            Orders you finish will show up here.
          </Text>
        </View>
      ) : null}

      {days.map((day, di) => (
        <View key={day.label}>
          <Text style={[s.sectionLabel, { marginTop: di === 0 ? 0 : 30, marginBottom: 0 }]}>
            {day.label.toUpperCase()}
          </Text>

          {day.items.map((o) => {
            const failed = o.status === 'FAILED'
            return (
              <View key={o.id}>
                <Rule style={{ marginTop: 14 }} />
                <View style={{ paddingVertical: 18 }}>
                  <View style={[s.row, { justifyContent: 'space-between', alignItems: 'baseline' }]}>
                    <Seat coach={o.coach} berth={o.berth} />
                    <Text style={{
                      fontSize: 14, fontWeight: '600',
                      color: failed ? C.red : C.green,
                    }}>
                      {failed ? 'Not delivered' : 'Delivered'}
                    </Text>
                  </View>

                  <View style={{ marginTop: 14 }}>
                    <Person name={o.contactName} phone={o.contactPhone} compact />
                  </View>

                  <Text style={{ fontSize: 14, color: C.muted, marginTop: 12 }} numberOfLines={1}>
                    {o.trainNo ?? '—'}
                    {o.trainName ? ` · ${o.trainName}` : ''}
                    {`   ·   ${timeIST(o.deliveredAt)}`}
                  </Text>

                  <Text style={{ fontSize: 14, color: C.muted, marginTop: 5 }}>
                    {o.amountCollectedPaise
                      ? `₹${Math.round(o.amountCollectedPaise / 100)} collected`
                      : o.paymentMode !== 'COD'
                        ? 'Prepaid'
                        : 'No cash recorded'}
                    {o.receivedBy ? `   ·   Taken by ${o.receivedBy}` : ''}
                  </Text>

                  {failed && o.failureReason ? (
                    <Text style={{ fontSize: 14, color: C.red, marginTop: 8, lineHeight: 20 }}>
                      {o.failureReason}
                    </Text>
                  ) : null}
                </View>
              </View>
            )
          })}
        </View>
      ))}
    </ScrollView>
  )
}
