import React, { useState } from 'react'
import { Image, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import type { RunOrder } from '../types'
import { Button, C, Card, Pill, Rupees, s } from '../ui'

export function OrderDetailScreen({
  order, onBack, onDeliver, onFail, onCapturePhoto, busy, offline,
}: {
  order: RunOrder
  onBack: () => void
  onDeliver: (receivedBy: string, amountCollected: string | null, proofKey: string | null) => void
  onFail: (reason: string) => void
  /** Uploads the photo and resolves to its object key, or null if it failed. */
  onCapturePhoto: (localUri: string) => Promise<string | null>
  busy: boolean
  offline: boolean
}) {
  const cod = order.paymentMode === 'COD'
  const [receivedBy, setReceivedBy] = useState('')
  const [collected, setCollected] = useState(
    cod && order.amountPaise !== null ? (order.amountPaise / 100).toFixed(2) : '',
  )
  const [failOpen, setFailOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [proofKey, setProofKey] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  async function takePhoto() {
    setPhotoError(null)
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      setPhotoError('Camera permission is needed to attach a photo.')
      return
    }

    // Compressed on the device: a full-resolution shot is several megabytes and
    // this uploads from a platform. 0.5 quality is plainly good enough to show
    // a handover happened.
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.5, exif: false })
    if (shot.canceled || !shot.assets?.[0]) return

    const uri = shot.assets[0].uri
    setPhotoUri(uri)
    setPhotoBusy(true)
    const key = await onCapturePhoto(uri)
    setPhotoBusy(false)

    if (key) {
      setProofKey(key)
    } else {
      setPhotoError('Could not upload the photo. You can still mark this delivered.')
      setPhotoUri(null)
    }
  }

  const kitchen = order.items.filter((i) => !i.isPacking)
  const packing = order.items.filter((i) => i.isPacking)
  const deliverable = order.status === 'DISPATCHED'

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16 }}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={[s.muted, { marginBottom: 12 }]}>← Back to run</Text>
      </Pressable>

      <Card>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <Text style={s.h2}>{order.externalOrderId}</Text>
          <Pill label={order.orderType} />
          <Pill label={order.status.replace('_', ' ')} />
        </View>

        <View style={[s.row, { marginTop: 12, alignItems: 'flex-start' }]}>
          <View style={s.coachBadge}>
            <Text style={s.coachText}>{order.coach ?? '—'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {order.orderType === 'BULK' ? (
              <>
                <Text style={{ fontWeight: '700', color: C.ink }}>{order.pax} pax</Text>
                <Text style={s.muted}>{order.handoverPoint}</Text>
              </>
            ) : (
              <Text style={{ fontWeight: '700', color: C.ink }}>Berth {order.berth ?? '—'}</Text>
            )}
          </View>
        </View>

        {order.contactPhone ? (
          <Pressable
            onPress={() => Linking.openURL(`tel:${order.contactPhone}`)}
            style={{
              marginTop: 12, borderWidth: 1, borderColor: C.line, borderRadius: 12,
              padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <View>
              <Text style={{ fontWeight: '600', color: C.ink }}>
                {order.contactName ?? 'Passenger'}
              </Text>
              <Text style={s.muted}>{order.contactPhone}</Text>
            </View>
            <Text style={{ fontWeight: '700', color: C.ink }}>Call</Text>
          </Pressable>
        ) : null}

        <View
          style={{
            marginTop: 12, borderRadius: 12, padding: 14, alignItems: 'center',
            backgroundColor: cod ? C.amberBg : C.slateBg,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '800', color: cod ? C.amber : C.muted }}>
            {cod ? 'COLLECT ON DELIVERY' : (order.paymentMode ?? 'PAYMENT')}
          </Text>
          <Text style={{ fontSize: 26, fontWeight: '800', color: cod ? C.amber : C.muted }}>
            {cod ? <Rupees paise={order.amountPaise} /> : 'Already paid'}
          </Text>
        </View>
      </Card>

      <Card>
        <Text style={[s.muted, { fontWeight: '700', marginBottom: 8 }]}>ITEMS</Text>
        {kitchen.map((i) => (
          <Text key={i.id} style={{ color: C.ink, marginBottom: 4 }}>
            <Text style={{ fontWeight: '800' }}>{i.qty}× </Text>
            {i.name}
          </Text>
        ))}
        {packing.length > 0 ? (
          <View style={[s.row, { flexWrap: 'wrap', marginTop: 8 }]}>
            {packing.map((i) => (
              <Pill key={i.id} label={`${i.name} ×${i.qty}`} />
            ))}
          </View>
        ) : null}
      </Card>

      {deliverable ? (
        <Card>
          <Text style={[s.muted, { fontWeight: '700', marginBottom: 10 }]}>COMPLETE DELIVERY</Text>

          {offline ? (
            <Text style={{ color: C.amber, marginBottom: 10, fontSize: 13 }}>
              No signal — this will be saved on the phone and sent when you reconnect.
            </Text>
          ) : null}

          {/* Photo first — it is the evidence that settles a dispute, and the
              thing we want a rider to reach for by default. */}
          {proofKey && photoUri ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Image
                source={{ uri: photoUri }}
                style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#e2e8f0' }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.green, fontWeight: '700' }}>Photo attached</Text>
                <Pressable onPress={takePhoto} hitSlop={8}>
                  <Text style={[s.muted, { textDecorationLine: 'underline' }]}>Retake</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ marginBottom: 12 }}>
              <Button
                label={photoBusy ? 'Uploading…' : 'Take delivery photo'}
                tone="ghost"
                busy={photoBusy}
                disabled={photoBusy || offline}
                onPress={takePhoto}
              />
              {offline ? (
                <Text style={[s.muted, { marginTop: 6, fontSize: 12 }]}>
                  A photo needs a connection. Deliver without one and it still counts.
                </Text>
              ) : null}
            </View>
          )}

          {photoError ? (
            <Text style={{ color: C.red, marginBottom: 10, fontSize: 13 }}>{photoError}</Text>
          ) : null}

          <Text style={[s.muted, { marginBottom: 6 }]}>
            Received by{proofKey ? ' (optional with a photo)' : ''}
          </Text>
          <TextInput
            value={receivedBy}
            onChangeText={setReceivedBy}
            placeholder="Name of the person who took it"
            placeholderTextColor="#94a3b8"
            style={[s.input, { marginBottom: 12 }]}
          />

          {cod ? (
            <>
              <Text style={[s.muted, { marginBottom: 6 }]}>Cash collected (₹)</Text>
              <TextInput
                value={collected}
                onChangeText={setCollected}
                keyboardType="decimal-pad"
                style={[s.input, { marginBottom: 12 }]}
              />
            </>
          ) : null}

          <Button
            label="Mark delivered"
            tone="success"
            busy={busy}
            disabled={!receivedBy.trim() && !proofKey}
            onPress={() => onDeliver(receivedBy.trim(), cod ? collected : null, proofKey)}
          />

          <View style={{ height: 10 }} />

          {failOpen ? (
            <>
              <Text style={[s.muted, { marginBottom: 6 }]}>What happened?</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={3}
                placeholder="Passenger not at seat, train did not halt…"
                placeholderTextColor="#94a3b8"
                style={[s.input, { marginBottom: 10, minHeight: 80, textAlignVertical: 'top' }]}
              />
              <Button
                label="Mark failed"
                tone="danger"
                busy={busy}
                disabled={!reason.trim()}
                onPress={() => onFail(reason.trim())}
              />
              <View style={{ height: 8 }} />
              <Button label="Cancel" tone="ghost" onPress={() => setFailOpen(false)} />
            </>
          ) : (
            <Button label="Could not deliver" tone="ghost" onPress={() => setFailOpen(true)} />
          )}
        </Card>
      ) : order.status === 'DELIVERED' ? (
        <Card style={{ backgroundColor: C.greenBg, borderColor: '#6ee7b7' }}>
          <Text style={{ color: C.green, fontWeight: '800' }}>Delivered</Text>
          <Text style={{ color: C.green, marginTop: 4 }}>
            Received by {order.delivery.proofValue ?? '—'}
          </Text>
          {order.delivery.amountCollectedPaise !== null ? (
            <Text style={{ color: C.green, marginTop: 2 }}>
              Collected <Rupees paise={order.delivery.amountCollectedPaise} />
            </Text>
          ) : null}
        </Card>
      ) : order.status === 'FAILED' ? (
        <Card style={{ backgroundColor: C.redBg, borderColor: '#fca5a5' }}>
          <Text style={{ color: C.red, fontWeight: '800' }}>Not delivered</Text>
          <Text style={{ color: C.red, marginTop: 4 }}>{order.delivery.failureReason ?? '—'}</Text>
        </Card>
      ) : (
        <Card>
          <Text style={s.muted}>
            Waiting on the kitchen. Delivery opens once the run is dispatched.
          </Text>
        </Card>
      )}
    </ScrollView>
  )
}
