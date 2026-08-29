import React from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View, Linking } from 'react-native'
import { Train, Phone, ChevronRight, Clock, Users } from 'lucide-react-native'
import type { Run, RunOrder } from '../types'
import { timeIST, untilLabel, delayLabel } from '../ui'

const colors = {
  primary: '#2457D6',
  softBlue: '#EEF3FF',
  success: '#16803C',
  successBg: '#EAF7EE',
  bg: '#F8F9FB',
  card: '#FFFFFF',
  text: '#17181C',
  secondaryText: '#686B76',
  border: '#E5E7EB',
  borderLight: '#F0F2F5',
  price: '#D9480F',
}

export function DeliveryTabScreen({
  runs,
  refreshing,
  onRefresh,
  onOpenOrder,
}: {
  runs: Run[]
  refreshing: boolean
  onRefresh: () => void
  onOpenOrder: (order: RunOrder, run: Run) => void
}) {
  // Group active dispatched deliveries by train, sorted by earliest arrival time
  const deliveriesByTrain = runs
    .map((r) => ({
      run: r,
      orders: r.orders
        .filter((o) => o.status === 'DISPATCHED')
        .sort((a, b) => {
          const coachA = a.coach || ''
          const coachB = b.coach || ''
          if (coachA !== coachB) return coachA.localeCompare(coachB, undefined, { numeric: true })
          const berthA = Number(a.berth) || 0
          const berthB = Number(b.berth) || 0
          return berthA - berthB
        }),
    }))
    .filter((g) => g.orders.length > 0)
    .sort((a, b) => {
      const timeA = a.run.timing?.effectiveArrival ? new Date(a.run.timing.effectiveArrival).getTime() : Infinity
      const timeB = b.run.timing?.effectiveArrival ? new Date(b.run.timing.effectiveArrival).getTime() : Infinity
      return timeA - timeB
    })

  const activeDeliveriesCount = deliveriesByTrain.reduce((sum, g) => sum + g.orders.length, 0)

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: 48,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={{
          fontSize: 11,
          fontWeight: '700',
          color: colors.secondaryText,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          marginBottom: 14,
        }}>
          DELIVER NOW · {activeDeliveriesCount}
        </Text>

        {deliveriesByTrain.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No active deliveries</Text>
            <Text style={{ fontSize: 14, fontWeight: '400', color: colors.secondaryText, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
              Pick up orders from the Orders tab to deliver them to passengers on the platform.
            </Text>
          </View>
        ) : (
          deliveriesByTrain.map(({ run, orders }) => {
            const until = untilLabel(run.timing.effectiveArrival)
            const delay = delayLabel(run.timing.delayMinutes)
            const isHere = until.text.toLowerCase() === 'train is here'

            return (
              <View key={run.key} style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 16,
                marginBottom: 16,
              }}>
                {/* Train & Platform Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Train size={15} color={colors.primary} />
                      <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
                        {run.trainNo} {run.trainName ? `· ${run.trainName}` : ''}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                        Platform {run.timing.platform || '—'}
                      </Text>
                      <Text style={{ fontSize: 13, color: '#9CA3AF' }}>·</Text>
                      <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText }}>
                        {timeIST(run.timing.effectiveArrival)}
                      </Text>
                      {delay && delay !== 'On time' ? (
                        <>
                          <Text style={{ fontSize: 13, color: '#9CA3AF' }}>·</Text>
                          <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText }}>
                            {delay}
                          </Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                  <View style={{
                    backgroundColor: isHere ? colors.successBg : colors.softBlue,
                    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
                  }}>
                    <Text style={{
                      fontSize: 11, fontWeight: '700',
                      color: isHere ? colors.success : colors.primary,
                    }}>{until.text}</Text>
                  </View>
                </View>

                {/* Coach Rows */}
                {orders.map((order, idx) => (
                  <View key={order.id}>
                    {idx > 0 && <View style={{ height: 1, backgroundColor: colors.borderLight, marginVertical: 8 }} />}
                    <Pressable
                      onPress={() => onOpenOrder(order, run)}
                      style={({ pressed }) => [{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 4,
                        opacity: pressed ? 0.7 : 1,
                      }]}
                    >
                      {/* Coach & Passenger info */}
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.3 }}>
                            {order.coach ? `${order.coach} ${order.berth ?? ''}` : '—'}
                          </Text>
                          <Text style={{
                            fontSize: 14, fontWeight: '700',
                            color: order.paymentMode === 'COD' ? colors.price : colors.success,
                          }}>
                            {order.paymentMode === 'COD'
                              ? `₹${order.amountPaise === null ? '?' : Math.round(order.amountPaise / 100)}`
                              : 'Paid'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText, marginTop: 2 }} numberOfLines={1}>
                          {order.contactName || 'No name'}
                          {order.handoverPoint ? ` · ${order.handoverPoint}` : ''}
                        </Text>
                      </View>

                      {/* Call Button */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {order.contactPhone ? (
                          <Pressable
                            onPress={() => Linking.openURL(`tel:${order.contactPhone}`)}
                            hitSlop={10}
                            style={({ pressed }) => [{
                              flexDirection: 'row', alignItems: 'center', gap: 4,
                              paddingHorizontal: 12, paddingVertical: 6,
                              borderRadius: 8, borderWidth: 1, borderColor: colors.primary,
                              opacity: pressed ? 0.6 : 1,
                            }]}
                          >
                            <Phone size={12} color={colors.primary} />
                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.5 }}>CALL</Text>
                          </Pressable>
                        ) : null}
                        <ChevronRight size={18} color="#9CA3AF" />
                      </View>
                    </Pressable>
                  </View>
                ))}
              </View>
            )
          })
        )}
      </ScrollView>
    </View>
  )
}

