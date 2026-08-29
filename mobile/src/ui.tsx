import React from 'react'
import { Text, View, StyleSheet, Pressable, ActivityIndicator } from 'react-native'

/**
 * Primitives for the rider app.
 *
 * Built for someone standing on a platform with one hand free, in daylight,
 * under time pressure, who may not read English comfortably. That drives every
 * choice here: touch targets never below 56px, numbers far larger than the
 * words around them, and colour used to mean one thing consistently — green is
 * go, amber is money, red is a problem.
 */
export const C = {
  bg: '#f6f7f9',
  card: '#ffffff',
  line: '#e6e8ec',
  ink: '#0d1424',
  muted: '#5a6478',
  faint: '#8a93a4',
  accent: '#4f46e5',
  accentSoft: '#eef2ff',
  green: '#047857',
  greenSoft: '#ecfdf5',
  amber: '#b45309',
  amberSoft: '#fffbeb',
  red: '#dc2626',
  redSoft: '#fef2f2',
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>
}

/**
 * The one control this app is really made of.
 *
 * `size="hero"` is the primary action on a screen — deliberately large enough
 * to hit without looking, because the rider is usually looking at the train.
 */
export function Button({
  label,
  onPress,
  tone = 'primary',
  size = 'normal',
  disabled,
  busy,
  icon,
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'success' | 'danger' | 'ghost'
  size?: 'normal' | 'hero'
  disabled?: boolean
  busy?: boolean
  icon?: string
}) {
  const bg =
    tone === 'success' ? C.green
    : tone === 'danger' ? C.red
    : tone === 'ghost' ? '#fff'
    : C.accent
  const fg = tone === 'ghost' ? C.muted : '#fff'
  const hero = size === 'hero'

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        s.button,
        hero && s.buttonHero,
        { backgroundColor: bg, opacity: disabled || busy ? 0.45 : pressed ? 0.88 : 1 },
        tone === 'ghost' && { borderWidth: 1.5, borderColor: C.line },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.buttonText, hero && s.buttonTextHero, { color: fg }]}>
          {icon ? `${icon}  ` : ''}{label}
        </Text>
      )}
    </Pressable>
  )
}

/**
 * Coach and berth, as big as the screen allows.
 *
 * This is the only thing a rider needs while walking the platform — everything
 * else on the card is context. It is the largest element on every screen it
 * appears on, on purpose.
 */
export function Seat({ coach, berth, size = 'normal' }: {
  coach: string | null
  berth: string | null
  size?: 'normal' | 'huge'
}) {
  const huge = size === 'huge'
  if (!coach) {
    return <Text style={[s.seatText, huge && s.seatTextHuge, { color: C.faint }]}>—</Text>
  }
  return (
    <View style={[s.seat, huge && s.seatHuge]}>
      <Text style={[s.seatText, huge && s.seatTextHuge]}>
        {coach}{berth ? ` ${berth}` : ''}
      </Text>
    </View>
  )
}

/** Cash to collect. Loud when there is money, invisible when there is not. */
export function Money({ paise, mode }: { paise: number | null; mode: string | null }) {
  if (mode !== 'COD') {
    return (
      <View style={[s.moneyBox, { backgroundColor: C.greenSoft }]}>
        <Text style={[s.moneyLabel, { color: C.green }]}>PAID ALREADY</Text>
        <Text style={[s.moneySub, { color: C.green }]}>Collect nothing</Text>
      </View>
    )
  }
  return (
    <View style={[s.moneyBox, { backgroundColor: C.amberSoft }]}>
      <Text style={[s.moneyLabel, { color: C.amber }]}>
        {paise === null ? 'ASK THE SHOP' : `COLLECT ₹${Math.round(paise / 100)}`}
      </Text>
      <Text style={[s.moneySub, { color: C.amber }]}>
        {paise === null ? 'Amount is missing' : 'Cash from passenger'}
      </Text>
    </View>
  )
}

export function timeIST(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/** "in 25 min" / "NOW" — the only clock a rider needs. */
export function untilLabel(iso: string | null): { text: string; urgent: boolean } {
  if (!iso) return { text: 'Time not known', urgent: false }
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (mins <= 0) return { text: 'TRAIN IS HERE', urgent: true }
  if (mins < 60) return { text: `in ${mins} min`, urgent: mins <= 20 }
  return { text: `in ${Math.floor(mins / 60)}h ${mins % 60}m`, urgent: false }
}

export function delayLabel(minutes: number | null): string | null {
  if (minutes === null) return null
  if (minutes <= 5) return 'On time'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m late` : `${m}m late`
}

export const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
    marginBottom: 12,
  },

  // 56px minimum, 64 for the hero — a platform is not a place for small targets.
  button: {
    borderRadius: 14,
    minHeight: 56,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonHero: { minHeight: 64, borderRadius: 16 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonTextHero: { fontSize: 19, fontWeight: '800' },

  seat: {
    backgroundColor: C.ink,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  seatHuge: { paddingVertical: 18, paddingHorizontal: 28, borderRadius: 18 },
  seatText: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  seatTextHuge: { fontSize: 46, letterSpacing: 2 },

  moneyBox: { borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18, alignItems: 'center' },
  moneyLabel: { fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },
  moneySub: { fontSize: 13, fontWeight: '600', marginTop: 2 },

  h1: { fontSize: 26, fontWeight: '800', color: C.ink },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: C.muted,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  muted: { color: C.muted, fontSize: 14 },
  train: { fontSize: 20, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },

  input: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 17,
    backgroundColor: '#fff',
    color: C.ink,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
})
