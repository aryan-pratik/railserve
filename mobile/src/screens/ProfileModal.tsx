import React from 'react'
import { Modal, Pressable, ScrollView, StatusBar, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  X,
  Phone,
  MapPin,
  Calendar,
  CheckCircle2,
  Banknote,
  Wifi,
  WifiOff,
  LogOut,
  ShieldCheck,
} from 'lucide-react-native'
import type { StoredUser } from '../storage'
import type { HistoryOrder } from '../types'

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
  red: '#DC2626',
  redBg: '#FEE2E2',
}

export function ProfileModal({
  visible,
  onClose,
  user,
  stationCode,
  serviceDate,
  history,
  offline,
  queueSize,
  onSignOut,
}: {
  visible: boolean
  onClose: () => void
  user: StoredUser
  stationCode?: string | null
  serviceDate?: string | null
  history: HistoryOrder[]
  offline: boolean
  queueSize: number
  onSignOut: () => void
}) {
  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()

  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
  const isToday = (o: HistoryOrder) =>
    o.deliveredAt
      ? new Date(o.deliveredAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === today
      : false

  const deliveredHistory = history.filter((o) => o.status === 'DELIVERED')
  const doneToday = deliveredHistory.filter(isToday).length
  const cashToday = deliveredHistory
    .filter(isToday)
    .reduce((sum, o) => sum + (o.amountCollectedPaise ?? 0), 0)

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar barStyle="dark-content" />

        {/* Top Modal Header */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingVertical: 16,
            backgroundColor: colors.card,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Rider Profile</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={({ pressed }) => [{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: colors.softBlue,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: pressed ? 0.6 : 1,
            }]}
          >
            <X size={18} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 48 }}
        >
          {/* Rider Identity Card */}
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 20,
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: 34,
                backgroundColor: colors.softBlue,
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Text style={{ color: colors.primary, fontSize: 24, fontWeight: '800' }}>{initials}</Text>
            </View>

            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{user.name}</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Phone size={14} color={colors.secondaryText} />
              <Text style={{ fontSize: 15, fontWeight: '500', color: colors.secondaryText }}>
                {user.phone || 'No phone registered'}
              </Text>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: colors.successBg,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 20,
                marginTop: 12,
              }}
            >
              <ShieldCheck size={14} color={colors.success} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.success }}>
                Platform Delivery Partner
              </Text>
            </View>
          </View>

          {/* Today's Shift Performance */}
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              color: colors.secondaryText,
              letterSpacing: 1.1,
              textTransform: 'uppercase',
              marginBottom: 10,
              marginLeft: 4,
            }}
          >
            TODAY'S SHIFT
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 18,
              marginBottom: 18,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <CheckCircle2 size={16} color={colors.primary} />
                  <Text style={{ fontSize: 13, fontWeight: '500', color: colors.secondaryText }}>Delivered</Text>
                </View>
                <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{doneToday}</Text>
              </View>

              <View style={{ width: 1, backgroundColor: colors.borderLight }} />

              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Banknote size={16} color={colors.success} />
                  <Text style={{ fontSize: 13, fontWeight: '500', color: colors.secondaryText }}>Cash on Duty</Text>
                </View>
                <Text style={{ fontSize: 24, fontWeight: '800', color: colors.success }}>
                  ₹{Math.round(cashToday / 100)}
                </Text>
              </View>
            </View>
          </View>

          {/* Station & Shift Details */}
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              color: colors.secondaryText,
              letterSpacing: 1.1,
              textTransform: 'uppercase',
              marginBottom: 10,
              marginLeft: 4,
            }}
          >
            ASSIGNMENT & STATUS
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: 6,
              marginBottom: 24,
            }}
          >
            {stationCode ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
                  <MapPin size={18} color={colors.primary} style={{ marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '500', color: colors.secondaryText }}>Station</Text>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 }}>
                      {stationCode}
                    </Text>
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: colors.borderLight, marginHorizontal: 16 }} />
              </>
            ) : null}

            {serviceDate ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Calendar size={18} color={colors.primary} style={{ marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '500', color: colors.secondaryText }}>Date</Text>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 }}>
                      {serviceDate}
                    </Text>
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: colors.borderLight, marginHorizontal: 16 }} />
              </>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
              {offline ? (
                <WifiOff size={18} color="#D97706" style={{ marginRight: 12 }} />
              ) : (
                <Wifi size={18} color={colors.success} style={{ marginRight: 12 }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '500', color: colors.secondaryText }}>Network Sync</Text>
                <Text style={{ fontSize: 15, fontWeight: '700', color: offline ? '#D97706' : colors.success, marginTop: 2 }}>
                  {offline
                    ? `Offline (${queueSize} pending writes)`
                    : queueSize > 0
                    ? `Syncing (${queueSize} pending)`
                    : 'Online & Up to Date'}
                </Text>
              </View>
            </View>
          </View>

          {/* Sign Out Button */}
          <Pressable
            onPress={() => {
              onClose()
              onSignOut()
            }}
            style={({ pressed }) => [{
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              backgroundColor: colors.redBg,
              borderWidth: 1,
              borderColor: '#FECACA',
              paddingVertical: 14,
              borderRadius: 14,
              opacity: pressed ? 0.7 : 1,
            }]}
          >
            <LogOut size={18} color={colors.red} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.red }}>Sign Out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}
