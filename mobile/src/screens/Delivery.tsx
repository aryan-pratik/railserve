import React, { useState } from 'react'
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { Run, RunOrder } from '../types'
import { Button, C, Card, Money, Seat, s, timeIST, untilLabel } from '../ui'

/**
 * One delivery, start to finish.
 *
 * Everything above the button answers "where am I going and what do I collect".
 * Below it is the single action: who took the food, then Delivered.
 *
 * Photo proof exists in the backend and is deliberately not wired in here yet —
 * it needs an object store configured, and until then a capture button that
 * always fails would be worse than no button.
 */
export function DeliveryScreen({
  order,
  run,
  onBack,
  onDeliver,
  onFail,
  busy,
  offline,
}: {
  order: RunOrder
  run: Run
  onBack: () => void
  onDeliver: (receivedBy: string) => void
  onFail: (reason: string) => void
  busy: boolean
  offline: boolean
}) {
  const [receivedBy, setReceivedBy] = useState('')
  const [failOpen, setFailOpen] = useState(false)
  const [reason, setReason] = useState('')

  const until = untilLabel(run.timing.effectiveArrival)
  const kitchen = order.items.filter((i) => !i.isPacking)
  const packing = order.items.filter((i) => i.isPacking)

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
    >
      <Pressable onPress={onBack} hitSlop={16} style={{ paddingVertical: 6, marginBottom: 8 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.muted }}>← Back</Text>
      </Pressable>

      {/* Where to go. The biggest thing on the screen, because it is the only
          thing that matters while walking a platform. */}
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        {order.handoverPoint ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.muted, letterSpacing: 1 }}>
              HAND OVER AT
            </Text>
            <Text style={[s.h1, { textAlign: 'center', marginTop: 6 }]}>{order.handoverPoint}</Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.muted, letterSpacing: 1 }}>
              COACH · SEAT
            </Text>
            <View style={{ marginTop: 8 }}>
              <Seat coach={order.coach} berth={order.berth} size="huge" />
            </View>
          </>
        )}

        <Text style={{ marginTop: 14, fontSize: 17, fontWeight: '700', color: C.ink }}>
          {run.trainNo} {run.trainName}
        </Text>
        <View style={[s.row, { marginTop: 6, gap: 8 }]}>
          {run.timing.platform ? (
            <View style={{ backgroundColor: C.ink, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                Platform {run.timing.platform}
              </Text>
            </View>
          ) : null}
          <Text style={{
            fontSize: 15, fontWeight: '800',
            color: until.urgent ? C.red : C.muted,
          }}>
            {timeIST(run.timing.effectiveArrival)} · {until.text}
          </Text>
        </View>
      </View>

      {/* What to collect. Second biggest — getting money wrong is the mistake
          that costs the rider personally. */}
      <View style={{ marginBottom: 14 }}>
        <Money paise={order.amountPaise} mode={order.paymentMode} />
      </View>

      <Card>
        <Text style={[s.sectionLabel, { marginTop: 0 }]}>IN THE BAG</Text>
        {kitchen.map((i) => (
          <Text key={i.id} style={{ fontSize: 17, color: C.ink, marginBottom: 4 }}>
            {i.qty} × {i.name}
          </Text>
        ))}
        {packing.length > 0 ? (
          <Text style={[s.muted, { marginTop: 6 }]}>
            + {packing.map((i) => i.name).join(', ')}
          </Text>
        ) : null}
        {order.pax ? (
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 6 }}>
            {order.pax} people
          </Text>
        ) : null}
      </Card>

      {/* Calling is the escape hatch when the seat is empty — it is not the
          normal path, so it sits below the job and above the action. */}
      {order.contactPhone ? (
        <Pressable
          onPress={() => Linking.openURL(`tel:${order.contactPhone}`)}
          accessibilityRole="button"
          accessibilityLabel="Call the passenger"
          style={({ pressed }) => [
            s.card,
            s.row,
            { justifyContent: 'center', opacity: pressed ? 0.9 : 1, marginBottom: 16 },
          ]}
        >
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.accent }}>
            📞  Call passenger
          </Text>
        </Pressable>
      ) : null}

      {offline ? (
        <View style={{ backgroundColor: C.amberSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <Text style={{ color: C.amber, fontWeight: '700', fontSize: 15 }}>
            No internet. You can still mark it delivered — it will be sent when you are back online.
          </Text>
        </View>
      ) : null}

      {/* Who took it. One field, big, with the keyboard set to a name. */}
      <Text style={[s.sectionLabel, { marginTop: 0 }]}>WHO TOOK THE FOOD?</Text>
      <TextInput
        value={receivedBy}
        onChangeText={setReceivedBy}
        placeholder="Passenger name"
        placeholderTextColor={C.faint}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        style={[s.input, { marginBottom: 14, fontSize: 19 }]}
      />

      <Button
        label="Delivered"
        icon="✓"
        tone="success"
        size="hero"
        busy={busy}
        disabled={!receivedBy.trim()}
        onPress={() => onDeliver(receivedBy.trim())}
      />

      <View style={{ height: 18 }} />

      {failOpen ? (
        <Card>
          <Text style={[s.sectionLabel, { marginTop: 0 }]}>WHAT HAPPENED?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Passenger not at seat"
            placeholderTextColor={C.faint}
            multiline
            style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
          />
          <View style={{ height: 12 }} />
          <Button
            label="Could not deliver"
            tone="danger"
            busy={busy}
            disabled={!reason.trim()}
            onPress={() => onFail(reason.trim())}
          />
          <View style={{ height: 8 }} />
          <Button label="Cancel" tone="ghost" onPress={() => setFailOpen(false)} />
        </Card>
      ) : (
        <Pressable onPress={() => setFailOpen(true)} hitSlop={12} style={{ paddingVertical: 12 }}>
          <Text style={{ textAlign: 'center', color: C.muted, fontSize: 16, fontWeight: '700' }}>
            Could not deliver?
          </Text>
        </Pressable>
      )}
    </ScrollView>
  )
}
