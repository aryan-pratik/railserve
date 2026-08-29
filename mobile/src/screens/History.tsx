import React from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import type { HistoryOrder } from '../types'
import { C, Card, Person, Pill, Seat, dateIST, s, timeIST } from '../ui'

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
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Cash first. It is the one number the rider is answerable for. */}
      <Card style={{ backgroundColor: C.ink }}>
        <Text style={{ color: '#9aa4b8', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }}>
          TODAY
        </Text>
        <View style={[s.row, { justifyContent: 'space-between', marginTop: 8 }]}>
          <View>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900' }}>{doneToday}</Text>
            <Text style={{ color: '#9aa4b8', fontSize: 13, fontWeight: '600' }}>delivered</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900' }}>
              ₹{Math.round(cashToday / 100)}
            </Text>
            <Text style={{ color: '#9aa4b8', fontSize: 13, fontWeight: '600' }}>cash collected</Text>
          </View>
        </View>
      </Card>

      {orders.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 60 }}>
          <Text style={s.h2}>Nothing delivered yet</Text>
          <Text style={[s.muted, { marginTop: 6, textAlign: 'center' }]}>
            Orders you finish will show up here.
          </Text>
        </View>
      ) : null}

      {days.map((day) => (
        <View key={day.label}>
          <Text style={[s.sectionLabel, { marginTop: 18 }]}>{day.label.toUpperCase()}</Text>
          {day.items.map((o) => {
            const failed = o.status === 'FAILED'
            return (
              <Card key={o.id}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <Seat coach={o.coach} berth={o.berth} />
                  <View style={{ alignItems: 'flex-end' }}>
                    <Pill
                      tone={failed ? 'red' : 'green'}
                      text={failed ? 'Not delivered' : 'Delivered'}
                    />
                    <Text style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>
                      {timeIST(o.deliveredAt)}
                    </Text>
                  </View>
                </View>

                <View style={{ height: 1, backgroundColor: C.line, marginVertical: 12 }} />

                <Person name={o.contactName} phone={o.contactPhone} compact />

                <View style={[s.row, { marginTop: 12, flexWrap: 'wrap', gap: 8 }]}>
                  {o.trainNo ? <Pill text={`${o.trainNo}${o.trainName ? ` · ${o.trainName}` : ''}`} /> : null}
                  {o.amountCollectedPaise ? (
                    <Pill tone="amber" text={`₹${Math.round(o.amountCollectedPaise / 100)} collected`} />
                  ) : o.paymentMode !== 'COD' ? (
                    <Pill tone="green" text="Prepaid" />
                  ) : null}
                </View>

                {o.receivedBy ? (
                  <Text style={{ fontSize: 14, color: C.muted, marginTop: 10 }}>
                    Taken by <Text style={{ fontWeight: '700', color: C.ink }}>{o.receivedBy}</Text>
                  </Text>
                ) : null}

                {failed && o.failureReason ? (
                  <View style={{ backgroundColor: C.redSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
                    <Text style={{ color: C.red, fontWeight: '600', fontSize: 14 }}>
                      {o.failureReason}
                    </Text>
                  </View>
                ) : null}
              </Card>
            )
          })}
        </View>
      ))}
    </ScrollView>
  )
}
