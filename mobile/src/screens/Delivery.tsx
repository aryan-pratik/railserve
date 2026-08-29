import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { Run, RunOrder } from '../types'
import { Button, C, Card, CallButton, Check, Money, Pill, Seat, s, timeIST, untilLabel } from '../ui'

/**
 * One delivery, start to finish.
 *
 * Everything above the button answers "where am I going, who am I looking for
 * and what do I collect". Below it is the single action.
 *
 * The passenger's name doubles as the proof, so it is offered as a button
 * rather than something to spell out: the rider confirms the person in front
 * of them is the person on the order with one tap. Typing is the fallback,
 * for when somebody else at the berth takes the food.
 *
 * Photo proof exists in the backend and is deliberately not wired in here yet —
 * it needs an object store configured, and a capture button that always failed
 * would be worse than no button.
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
  const passenger = order.contactName?.trim() || ''

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
    >
      <Pressable onPress={onBack} hitSlop={16} style={{ paddingVertical: 6, marginBottom: 6 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.muted }}>← Back</Text>
      </Pressable>

      {/* Where to go. The biggest thing on the screen, because it is the only
          thing that matters while walking a platform. */}
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        {order.handoverPoint ? (
          <>
            <Text style={s.sectionLabel}>HAND OVER AT</Text>
            <Text style={[s.h1, { textAlign: 'center' }]}>{order.handoverPoint}</Text>
          </>
        ) : (
          <>
            <Text style={s.sectionLabel}>COACH · SEAT</Text>
            <Seat coach={order.coach} berth={order.berth} size="huge" />
          </>
        )}

        <Text style={{ marginTop: 14, fontSize: 17, fontWeight: '700', color: C.ink }}>
          {run.trainNo} {run.trainName}
        </Text>
        <View style={[s.row, { marginTop: 8, gap: 8, flexWrap: 'wrap', justifyContent: 'center' }]}>
          {run.timing.platform ? <Pill tone="dark" text={`Platform ${run.timing.platform}`} /> : null}
          <Pill
            tone={until.urgent ? 'red' : 'neutral'}
            text={`${timeIST(run.timing.effectiveArrival)} · ${until.text}`}
          />
        </View>
      </View>

      {/* Who to look for. On the way to the berth this is what the rider is
          scanning faces for, so it sits above the money and the food. */}
      <Card>
        <Text style={[s.sectionLabel, { marginTop: 0 }]}>GIVE IT TO</Text>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink }} numberOfLines={2}>
              {passenger || 'Name not given'}
            </Text>
            {order.contactPhone ? (
              <Text style={{ fontSize: 16, color: C.muted, marginTop: 2 }}>
                {order.contactPhone}
              </Text>
            ) : null}
            {order.pax ? (
              <Text style={{ fontSize: 14, color: C.faint, marginTop: 4 }}>{order.pax} people</Text>
            ) : null}
          </View>
          {order.contactPhone ? <CallButton phone={order.contactPhone} /> : null}
        </View>
      </Card>

      {/* What to collect. Getting money wrong is the mistake that costs the
          rider personally. */}
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
      </Card>

      {offline ? (
        <View style={{ backgroundColor: C.amberSoft, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <Text style={{ color: C.amber, fontWeight: '700', fontSize: 15 }}>
            No internet. You can still mark it delivered — it will be sent when you are back online.
          </Text>
        </View>
      ) : null}

      {/* Who took it. One tap in the normal case; typing only when it was
          somebody other than the passenger on the order. */}
      <Text style={s.sectionLabel}>WHO TOOK THE FOOD?</Text>

      {passenger ? (
        <Pressable
          onPress={() => setReceivedBy(receivedBy === passenger ? '' : passenger)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: receivedBy === passenger }}
          accessibilityLabel={`The passenger, ${passenger}, took it`}
          style={({ pressed }) => [
            s.row,
            {
              padding: 12, borderRadius: 12, marginBottom: 10,
              backgroundColor: receivedBy === passenger ? C.accentSoft : '#fff',
              borderWidth: 1.5,
              borderColor: receivedBy === passenger ? C.accent : C.line,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Check on={receivedBy === passenger} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink, flex: 1 }} numberOfLines={1}>
            {passenger}
          </Text>
        </Pressable>
      ) : null}

      <TextInput
        value={receivedBy === passenger ? '' : receivedBy}
        onChangeText={setReceivedBy}
        placeholder={passenger ? 'Or type another name' : 'Name of the person'}
        placeholderTextColor={C.faint}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        style={[s.input, { marginBottom: 14, fontSize: 18 }]}
      />

      <Button
        label="Delivered"
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
