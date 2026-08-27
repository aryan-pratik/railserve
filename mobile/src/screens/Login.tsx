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
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 80 }}>
        <Text style={[s.h1, { textAlign: 'center' }]}>RailServe</Text>
        <Text style={[s.muted, { textAlign: 'center', marginTop: 4, marginBottom: 28 }]}>
          Delivery agent
        </Text>

        <View style={{ gap: 12 }}>
          <View>
            <Text style={[s.muted, { marginBottom: 6 }]}>Phone number</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="number-pad"
              autoComplete="tel"
              placeholder="9000000004"
              placeholderTextColor="#94a3b8"
              style={s.input}
            />
          </View>

          <View>
            <Text style={[s.muted, { marginBottom: 6 }]}>Password</Text>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry style={s.input} />
          </View>

          {error ? <Text style={{ color: C.red, fontWeight: '600' }}>{error}</Text> : null}

          <Button label="Sign in" onPress={submit} busy={busy} disabled={!phone || !password} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
