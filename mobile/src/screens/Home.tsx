import React, { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View, Linking } from 'react-native'
import { Store, Train, Phone, Check, ChevronRight, ChevronDown, Clock, Users } from 'lucide-react-native'
import type { Run } from '../types'
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
  onReturn?: (orderId: string) => void
  onOpenOrder?: (order: any, run: Run) => void
  refreshing: boolean
  onRefresh: () => void
  busy: boolean
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // Ready at the shop counter, sorted by earliest arrival time first
  const toPickUp = runs
    .map((r) => ({
      run: r,
      orders: r.orders
        .filter((o) => o.status === 'PREPARED')
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

  // By default, expand the first (most urgent) train
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (toPickUp.length > 0) initial.add(toPickUp[0].run.key)
    return initial
  })

  function toggleExpand(runKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(runKey)) next.delete(runKey)
      else next.add(runKey)
      return next
    })
  }

  const cooking = runs.reduce(
    (n, r) => n + r.orders.filter((o) => ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED'].includes(o.status)).length,
    0,
  )

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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: selected.length > 0 ? 120 : 48,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <View style={{
            width: 44, height: 44, borderRadius: 12, backgroundColor: colors.softBlue,
            justifyContent: 'center', alignItems: 'center',
          }}>
            <Store size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary, letterSpacing: 0.8, marginBottom: 3 }}>
              PICK UP YOUR ORDER
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText, lineHeight: 18 }}>
              Tick the ones you are taking. Leave the rest for another rider.
            </Text>
          </View>
        </View>

        {toPickUp.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No orders to pick up</Text>
            <Text style={{ fontSize: 14, fontWeight: '400', color: colors.secondaryText, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
              {cooking > 0
                ? `${cooking} order${cooking === 1 ? '' : 's'} still being cooked.\nPull down to check again.`
                : 'All caught up! Pull down to refresh.'}
            </Text>
          </View>
        ) : (
          toPickUp.map(({ run, orders }) => {
            const until = untilLabel(run.timing.effectiveArrival)
            const delay = delayLabel(run.timing.delayMinutes)
            const ids = orders.map((o) => o.id)
            const allOn = ids.every((id) => picked.has(id))
            const someOn = ids.filter((id) => picked.has(id)).length
            const isHere = until.text.toLowerCase() === 'train is here'
            const isExpanded = expanded.has(run.key)

            return (
              <View key={run.key} style={{ marginBottom: 18 }}>
                <View style={{
                  backgroundColor: colors.softBlue,
                  borderRadius: 16,
                  borderWidth: 1, borderColor: '#D8E2F8',
                  padding: 16, marginBottom: isExpanded ? 12 : 0,
                }}>
                  <Pressable
                    onPress={() => toggleExpand(run.key)}
                    style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>
                          {run.trainNo ?? '—'}
                        </Text>
                        <Text style={{ fontSize: 14, color: colors.text, marginTop: 3, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 0.2 }}>
                          {run.trainName}
                        </Text>
                      </View>
                      <View style={{
                        backgroundColor: isHere ? colors.successBg : '#FFFFFF',
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                      }}>
                        <Text style={{
                          fontSize: 12, fontWeight: '600',
                          color: isHere ? colors.success : colors.primary,
                        }}>{until.text}</Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 4, flex: 1, paddingRight: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Clock size={14} color={colors.secondaryText} />
                          <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText }}>
                            {timeIST(run.timing.effectiveArrival)}
                          </Text>
                        </View>
                        {run.timing.platform ? (
                          <>
                            <Text style={{ fontSize: 13, color: '#9CA3AF', marginHorizontal: 6 }}>·</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Train size={14} color={colors.secondaryText} />
                              <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText }}>
                                Platform {run.timing.platform}
                              </Text>
                            </View>
                          </>
                        ) : null}
                        <Text style={{ fontSize: 13, color: '#9CA3AF', marginHorizontal: 6 }}>·</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Users size={14} color={colors.secondaryText} />
                          <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText }}>
                            {orders.length} waiting
                          </Text>
                        </View>
                        {delay && delay !== 'On time' ? (
                          <>
                            <Text style={{ fontSize: 13, color: '#9CA3AF', marginHorizontal: 6 }}>·</Text>
                            <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText }}>
                              {delay}
                            </Text>
                          </>
                        ) : null}
                      </View>

                      <View style={{ paddingBottom: 2, paddingLeft: 4 }}>
                        <Train size={36} color={colors.primary} />
                      </View>
                    </View>
                  </Pressable>

                  <View style={{ height: 1, backgroundColor: '#D8E2F8', marginVertical: 12 }} />

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Pressable
                      onPress={() => toggleAll(ids, allOn)}
                      hitSlop={8}
                      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primary }}>
                        {allOn ? 'Clear all' : `Select all ${orders.length}`}
                        {!allOn && someOn > 0 ? `  ·  ${someOn} ticked` : ''}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => toggleExpand(run.key)}
                      hitSlop={8}
                      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primary }}>
                        {isExpanded ? 'Hide' : 'View orders'}
                      </Text>
                      {isExpanded ? (
                        <ChevronDown size={18} color={colors.primary} />
                      ) : (
                        <ChevronRight size={18} color={colors.primary} />
                      )}
                    </Pressable>
                  </View>
                </View>

                {isExpanded && orders.map((o) => {
                  const on = picked.has(o.id)
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => toggle(o.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={({ pressed }) => [{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: on ? colors.softBlue : colors.card,
                        borderRadius: 16, borderWidth: 1,
                        borderColor: on ? colors.primary : colors.border,
                        padding: 16, marginBottom: 10,
                        opacity: pressed ? 0.7 : 1,
                      }]}
                    >
                      <View style={{
                        width: 24, height: 24, borderRadius: 6,
                        borderWidth: 1.5, borderColor: on ? colors.primary : '#D1D5DB',
                        backgroundColor: on ? colors.primary : 'transparent',
                        justifyContent: 'center', alignItems: 'center',
                        marginRight: 14,
                      }}>
                        {on && <Check size={16} color="#FFFFFF" strokeWidth={3} />}
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.3 }}>
                            {o.coach ? `${o.coach} ${o.berth ?? ''}` : '—'}
                          </Text>
                          <Text style={{
                            fontSize: 17, fontWeight: '700',
                            color: o.paymentMode === 'COD' ? colors.price : colors.success,
                          }}>
                            {o.paymentMode === 'COD'
                              ? `₹${o.amountPaise === null ? '?' : Math.round(o.amountPaise / 100)}`
                              : 'Paid'}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
                          <View style={{ flex: 1, marginRight: 10 }}>
                            <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text }} numberOfLines={1}>
                              {o.contactName || 'No name'}
                            </Text>
                            <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText, marginTop: 2 }}>
                              {o.contactPhone || 'No phone'}
                            </Text>
                          </View>
                          {o.contactPhone && (
                            <Pressable
                              onPress={() => Linking.openURL(`tel:${o.contactPhone}`)}
                              style={({ pressed }) => [{
                                flexDirection: 'row', alignItems: 'center', gap: 5,
                                paddingHorizontal: 14, paddingVertical: 6,
                                borderRadius: 8, borderWidth: 1, borderColor: colors.primary,
                                backgroundColor: 'transparent',
                                opacity: pressed ? 0.6 : 1,
                              }]}
                            >
                              <Phone size={13} color={colors.primary} />
                              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.5 }}>CALL</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            )
          })
        )}

        {cooking > 0 && toPickUp.length > 0 ? (
          <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: '400', textAlign: 'center', marginTop: 24 }}>
            {cooking} more still being cooked
          </Text>
        ) : null}
      </ScrollView>

      {selected.length > 0 ? (
        <View style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20,
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}>
          <Pressable
            disabled={busy}
            onPress={() => {
              onTake(selected)
              setPicked(new Set())
            }}
            style={({ pressed }) => [{
              backgroundColor: colors.primary,
              borderRadius: 12,
              minHeight: 50,
              paddingHorizontal: 18,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: busy ? 0.4 : (pressed ? 0.85 : 1),
            }]}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', letterSpacing: 0.2, color: '#fff' }}>
              {busy ? 'Processing...' : `Picked up ${selected.length} order${selected.length === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
