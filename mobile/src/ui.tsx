import React from 'react'
import { Text, View, StyleSheet, Pressable, ActivityIndicator } from 'react-native'

export const C = {
  bg: '#f1f5f9',
  card: '#ffffff',
  line: '#e2e8f0',
  ink: '#0f172a',
  muted: '#64748b',
  dark: '#0f172a',
  green: '#059669',
  amber: '#b45309',
  amberBg: '#fef3c7',
  red: '#dc2626',
  redBg: '#fee2e2',
  greenBg: '#d1fae5',
  slateBg: '#f1f5f9',
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function Pill({
  label, bg = C.slateBg, fg = C.muted,
}: { label: string; bg?: string; fg?: string }) {
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: fg }]}>{label}</Text>
    </View>
  )
}

export function Button({
  label, onPress, tone = 'primary', disabled, busy,
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'success' | 'danger' | 'ghost'
  disabled?: boolean
  busy?: boolean
}) {
  const bg =
    tone === 'success' ? C.green : tone === 'danger' ? C.red : tone === 'ghost' ? '#fff' : C.dark
  const fg = tone === 'ghost' ? C.ink : '#fff'

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: bg, opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1 },
        tone === 'ghost' && { borderWidth: 1, borderColor: C.line },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  )
}

export function Rupees({ paise, style }: { paise: number | null; style?: object }) {
  if (paise === null) return <Text style={style}>—</Text>
  return <Text style={style}>₹{(paise / 100).toFixed(2)}</Text>
}

export function timeIST(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export function delayLabel(minutes: number | null): string | null {
  if (minutes === null) return null
  if (minutes <= 5) return 'on time'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m late` : `${m}m late`
}

export const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    marginBottom: 12,
  },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  button: {
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink },
  muted: { color: C.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: '#fff',
    color: C.ink,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coachBadge: {
    backgroundColor: C.dark,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 56,
    alignItems: 'center',
  },
  coachText: { color: '#fff', fontSize: 18, fontWeight: '800' },
})
