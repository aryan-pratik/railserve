import React, { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Train, Phone, Lock, Eye, EyeOff, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react-native'
import { login } from '../api'
import { saveSession, type StoredUser } from '../storage'

const colors = {
  primary: '#2457D6',
  primaryDark: '#1B42A6',
  softBlue: '#EEF3FF',
  bg: '#F8F9FB',
  card: '#FFFFFF',
  text: '#17181C',
  secondaryText: '#686B76',
  border: '#E5E7EB',
  borderFocus: '#2457D6',
  red: '#DC2626',
  redBg: '#FEE2E2',
  redBorder: '#FECACA',
}

export function LoginScreen({ onDone }: { onDone: (token: string, user: StoredUser) => void }) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!phone.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const r = await login(phone.trim(), password)
      await saveSession(r.token, r.user)
      onDone(r.token, r.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const isValid = phone.trim().length >= 8 && password.length >= 1

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingVertical: 36,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand Header */}
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: colors.softBlue,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 16,
              borderWidth: 1,
              borderColor: '#D8E2F8',
            }}
          >
            <Train size={32} color={colors.primary} />
          </View>

          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>
            RailServe
          </Text>

          <Text
            style={{
              fontSize: 14,
              fontWeight: '400',
              color: colors.secondaryText,
              textAlign: 'center',
              marginTop: 10,
              paddingHorizontal: 20,
              lineHeight: 20,
            }}
          >
            Sign in with your registered mobile number to start your platform delivery shift.
          </Text>
        </View>

        {/* Login Card */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.04,
            shadowRadius: 10,
            elevation: 2,
          }}
        >
          {/* Error Banner */}
          {error ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: colors.redBg,
                borderWidth: 1,
                borderColor: colors.redBorder,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                marginBottom: 20,
              }}
            >
              <AlertCircle size={18} color={colors.red} />
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '500', color: colors.red }}>
                {error}
              </Text>
            </View>
          ) : null}

          {/* Phone Field */}
          <View style={{ marginBottom: 18 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: colors.secondaryText,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              PHONE NUMBER
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#FAFAFB',
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                height: 48,
              }}
            >
              <Phone size={16} color={colors.secondaryText} style={{ marginRight: 10 }} />
              <TextInput
                value={phone}
                onChangeText={(t) => {
                  setError(null)
                  setPhone(t)
                }}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="Enter phone number"
                placeholderTextColor="#9CA3AF"
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: '500',
                  color: colors.text,
                  // @ts-ignore
                  outlineStyle: 'none',
                  outlineWidth: 0,
                  borderWidth: 0,
                  padding: 0,
                }}
              />
            </View>
          </View>

          {/* Password Field */}
          <View style={{ marginBottom: 22 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: colors.secondaryText,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              PASSWORD
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#FAFAFB',
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                height: 48,
              }}
            >
              <Lock
                size={16}
                color={colors.secondaryText}
                style={{ marginRight: 10 }}
              />

              <TextInput
                value={password}
                onChangeText={(t) => {
                  setError(null)
                  setPassword(t)
                }}
                secureTextEntry={!showPassword}
                placeholder="Enter password"
                placeholderTextColor="#9CA3AF"
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: '500',
                  color: colors.text,
                  // @ts-ignore
                  outlineStyle: 'none',
                  outlineWidth: 0,
                  borderWidth: 0,
                  padding: 0,
                }}
              />

              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={12}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 4 }]}
              >
                {showPassword ? (
                  <EyeOff size={18} color={colors.secondaryText} />
                ) : (
                  <Eye size={18} color={colors.secondaryText} />
                )}
              </Pressable>
            </View>
          </View>

          {/* Submit Button */}
          <Pressable
            onPress={submit}
            disabled={!isValid || busy}
            style={({ pressed }) => [{
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              backgroundColor: !isValid || busy ? '#A5B4FC' : colors.primary,
              height: 52,
              borderRadius: 14,
              opacity: pressed ? 0.8 : 1,
              shadowColor: colors.primary,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: !isValid || busy ? 0 : 0.25,
              shadowRadius: 8,
              elevation: !isValid || busy ? 0 : 3,
            }]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Sign In</Text>
                <ArrowRight size={18} color="#FFFFFF" />
              </>
            )}
          </Pressable>
        </View>

        {/* Footer Support */}
        <View style={{ alignItems: 'center', marginTop: 24 }}>
          <Text style={{ fontSize: 13, fontWeight: '400', color: colors.secondaryText, textAlign: 'center' }}>
            Trouble signing in? Contact your Station Manager.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
