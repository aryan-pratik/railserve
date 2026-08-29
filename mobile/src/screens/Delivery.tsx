import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { Run, RunOrder } from '../types'
import { Button, C, CallButton, Check, Money, Rule, Seat, s, timeIST, untilLabel, delayLabel } from '../ui'

/**
 * One delivery, start to finish.
 *
 * Read top to bottom it answers, in order: where am I going, who am I looking
 * for, what do I collect, what is in the bag. Then the single action.
 *
 * The passenger's name doubles as the proof, so it is offered as a tick rather
 * than something to spell out: the rider confirms the person in front of them
 * is the person on the order with one tap. Typing is the fallback, for when
 * somebody else at the berth takes the food.
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
  const delay = delayLabel(run.timing.delayMinutes)
  const kitchen = order.items.filter((i) => !i.isPacking)
  const packing = order.items.filter((i) => i.isPacking)
  const passenger = order.contactName?.trim() || ''

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 56 }}
    >
      <Pressable onPress={onBack} hitSlop={16} style={{ paddingVertical: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.muted }}>← Back</Text>
      </Pressable>

      {/* Where to go. The biggest thing on the screen, because it is the only
          thing that matters while walking a platform. */}
      <View style={{ paddingTop: 12, paddingBottom: 24 }}>
        <Text style={s.label}>{order.handoverPoint ? 'HAND OVER AT' : 'COACH · SEAT'}</Text>
        <View style={{ marginTop: 10 }}>
          {order.handoverPoint ? (
            <Text style={s.h1}>{order.handoverPoint}</Text>
          ) : (
            <Seat coach={order.coach} berth={order.berth} size="huge" />
          )}
        </View>

        <Text style={{ fontSize: 16, color: C.ink, marginTop: 18 }} numberOfLines={1}>
          {run.trainNo} · {run.trainName ?? 'Train name not known'}
        </Text>
        <Text style={{
          fontSize: 15, marginTop: 6,
          color: until.urgent ? C.red : C.muted,
          fontWeight: until.urgent ? '700' : '400',
        }}>
          {timeIST(run.timing.effectiveArrival)}   ·   {until.text}
          {run.timing.platform ? `   ·   Platform ${run.timing.platform}` : ''}
        </Text>
        {delay && delay !== 'On time' ? (
          <Text style={{ fontSize: 14, color: C.red, marginTop: 4 }}>{delay}</Text>
        ) : null}
      </View>

      <Rule />

      {/* Who to look for. On the way to the berth this is what the rider is
          scanning faces for, so it sits above the money and the food. */}
      <View style={{ paddingVertical: 22 }}>
        <Text style={s.label}>GIVE IT TO</Text>
        <View style={[s.row, { justifyContent: 'space-between', marginTop: 12 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: C.ink }} numberOfLines={2}>
              {passenger || 'Name not given'}
            </Text>
            {order.contactPhone ? (
              <Text style={{ fontSize: 15, color: C.muted, marginTop: 5 }}>
                {order.contactPhone}
              </Text>
            ) : null}
            {order.pax ? (
              <Text style={{ fontSize: 14, color: C.faint, marginTop: 5 }}>{order.pax} people</Text>
            ) : null}
          </View>
          {order.contactPhone ? <CallButton phone={order.contactPhone} /> : null}
        </View>
      </View>

      <Rule />

      {/* Getting the money wrong is the mistake that costs the rider. */}
      <View style={{ paddingVertical: 22 }}>
        <Money paise={order.amountPaise} mode={order.paymentMode} />
      </View>

      <Rule />

      <View style={{ paddingVertical: 22 }}>
        <Text style={s.label}>IN THE BAG</Text>
        <View style={{ marginTop: 12 }}>
          {kitchen.map((i) => (
            <Text key={i.id} style={{ fontSize: 16, color: C.ink, marginBottom: 6 }}>
              {i.qty} × {i.name}
            </Text>
          ))}
          {packing.length > 0 ? (
            <Text style={[s.muted, { marginTop: 6 }]}>
              + {packing.map((i) => i.name).join(', ')}
            </Text>
          ) : null}
        </View>
      </View>

      <Rule />

      {offline ? (
        <View style={{ paddingVertical: 18 }}>
          <Text style={{ color: C.amber, fontWeight: '600', fontSize: 14, lineHeight: 20 }}>
            No internet. You can still mark it delivered — it will be sent when you are
            back online.
          </Text>
        </View>
      ) : null}

      {/* Who took it. One tap in the normal case; typing only when it was
          somebody other than the passenger on the order. */}
      <View style={{ paddingTop: 22 }}>
        <Text style={s.label}>WHO TOOK THE FOOD?</Text>

        {passenger ? (
          <Pressable
            onPress={() => setReceivedBy(receivedBy === passenger ? '' : passenger)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: receivedBy === passenger }}
            accessibilityLabel={`The passenger, ${passenger}, took it`}
            style={({ pressed }) => [
              s.row,
              {
                gap: 14, paddingVertical: 16, paddingHorizontal: 16,
                marginTop: 14, borderRadius: 10, borderWidth: 1,
                backgroundColor: receivedBy === passenger ? C.subtle : '#fff',
                borderColor: receivedBy === passenger ? C.ink : C.line,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Check on={receivedBy === passenger} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: C.ink, flex: 1 }} numberOfLines={1}>
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
          style={[s.input, { marginTop: 12 }]}
        />

        <View style={{ marginTop: 24 }}>
          <Button
            label="Delivered"
            tone="success"
            size="hero"
            busy={busy}
            disabled={!receivedBy.trim()}
            onPress={() => onDeliver(receivedBy.trim())}
          />
        </View>
      </View>

      <View style={{ marginTop: 28 }}>
        {failOpen ? (
          <>
            <Text style={s.label}>WHAT HAPPENED?</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Passenger not at seat"
              placeholderTextColor={C.faint}
              multiline
              style={[s.input, { minHeight: 90, textAlignVertical: 'top', marginTop: 12 }]}
            />
            <View style={{ height: 14 }} />
            <Button
              label="Could not deliver"
              tone="danger"
              busy={busy}
              disabled={!reason.trim()}
              onPress={() => onFail(reason.trim())}
            />
            <View style={{ height: 10 }} />
            <Button label="Cancel" tone="ghost" onPress={() => setFailOpen(false)} />
          </>
        ) : (
          <Pressable onPress={() => setFailOpen(true)} hitSlop={12} style={{ paddingVertical: 12 }}>
            <Text style={{ textAlign: 'center', color: C.muted, fontSize: 15 }}>
              Could not deliver?
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  )
}
