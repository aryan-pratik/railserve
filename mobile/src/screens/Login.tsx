import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native'
import { login } from '../api'
import { saveSession, type StoredUser } from '../storage'
import { Button, C, s } from '../ui'

export function LoginScreen({ onDone }: { onDone: (token: string, user: StoredUser) => void }) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const r = await login(phone.trim(), password)
      await saveSession(r.token, r.user)
      onDone(r.token, r.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 96, paddingBottom: 40 }}>
        <Text style={s.h1}>RailServe</Text>
        <Text style={[s.muted, { marginTop: 6, marginBottom: 44 }]}>Delivery partner</Text>

        <View style={{ gap: 20 }}>
          <View>
            <Text style={[s.label, { marginBottom: 8 }]}>PHONE NUMBER</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="number-pad"
              autoComplete="tel"
              placeholder="9000000004"
              placeholderTextColor={C.faint}
              style={s.input}
            />
          </View>

          <View>
            <Text style={[s.label, { marginBottom: 8 }]}>PASSWORD</Text>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry style={s.input} />
          </View>

          {error ? <Text style={{ color: C.red, fontSize: 14 }}>{error}</Text> : null}

          <View style={{ marginTop: 8 }}>
            <Button
              label="Sign in"
              size="hero"
              onPress={submit}
              busy={busy}
              disabled={!phone || !password}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
