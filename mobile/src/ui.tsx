import React from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Store, Send, CheckCircle2 } from 'lucide-react-native'

/**
 * Primitives for the rider app.
 *
 * Built for someone standing on a platform with one hand free, in daylight,
 * under time pressure, who may not read English comfortably.
 *
 * The visual language is deliberately plain: white ground, hairline rules,
 * and hierarchy carried by type size and space rather than by boxes, colour
 * fills or shadows. A rider glances at this for two seconds at a time, so the
 * screen should read like a printed docket — the thing that matters is simply
 * the biggest thing there. Colour is reserved for the two facts that cost
 * money when missed: how long until the train, and how much cash to collect.
 */
export const C = {
  bg: '#ffffff',
  subtle: '#f7f7f8',
  line: '#ececf0',
  ink: '#18181b',
  muted: '#6b6b76',
  faint: '#9a9aa5',
  accent: '#3538cd',
  green: '#027a48',
  amber: '#b54708',
  red: '#d92d20',
}

/** A plain panel. Hairline, never a shadow. */
export function Card({
  children,
  style,
  selected,
}: {
  children: React.ReactNode
  style?: object
  selected?: boolean
}) {
  return <View style={[s.card, selected && s.cardSelected, style]}>{children}</View>
}

/** A hairline rule, used to separate facts inside a panel. */
export function Rule({ style }: { style?: object }) {
  return <View style={[{ height: 1, backgroundColor: C.line }, style]} />
}

/**
 * The one control this app is really made of.
 *
 * `size="hero"` is the primary action on a screen — full width and large
 * enough to hit without looking, because the rider is watching the train.
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
    : C.ink
  const fg = tone === 'ghost' ? C.muted : '#fff'
  const hero = size === 'hero'

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [
        s.button,
        hero && s.buttonHero,
        { backgroundColor: bg, opacity: disabled || busy ? 0.4 : pressed ? 0.85 : 1 },
        tone === 'ghost' && { borderWidth: 1, borderColor: C.line },
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
 * Coach and berth.
 *
 * This is the address, so it is set as text rather than dressed in a chip —
 * the size alone makes it the first thing read, and a filled box around it
 * only adds ink.
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
    <Text style={[s.seatText, huge && s.seatTextHuge]}>
      {coach}{berth ? ` ${berth}` : ''}
    </Text>
  )
}

/**
 * Who to hand the food to, and how to reach them.
 *
 * On the card rather than one tap further in: a rider who arrives at an empty
 * berth needs the number right then, and going back into a detail screen to
 * find it is the moment the train leaves.
 */
export function Person({ name, phone, compact }: {
  name: string | null
  phone: string | null
  compact?: boolean
}) {
  if (!name && !phone) return null
  return (
    <View style={[s.row, { justifyContent: 'space-between', gap: 12 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ fontSize: compact ? 15 : 16, fontWeight: '600', color: C.ink }}
          numberOfLines={1}
        >
          {name ?? 'Name not given'}
        </Text>
        {phone ? (
          <Text style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>{phone}</Text>
        ) : null}
      </View>
      {phone ? <CallButton phone={phone} /> : null}
    </View>
  )
}

/** A phone number is only useful if calling it is one tap. */
export function CallButton({ phone, wide }: { phone: string; wide?: boolean }) {
  return (
    <Pressable
      onPress={() => Linking.openURL(`tel:${phone}`)}
      accessibilityRole="button"
      accessibilityLabel={`Call ${phone}`}
      hitSlop={10}
      style={({ pressed }) => [
        s.callBtn,
        wide && { alignSelf: 'stretch' },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', color: C.accent, letterSpacing: 0.3 }}>
        {wide ? 'CALL PASSENGER' : 'CALL'}
      </Text>
    </Pressable>
  )
}

/**
 * A tick box big enough to hit while walking.
 *
 * Selection is the point of the pickup list — a rider takes the five orders
 * they can carry, not all forty.
 */
export function Check({ on }: { on: boolean }) {
  return (
    <View style={[s.check, on && { backgroundColor: C.ink, borderColor: C.ink }]}>
      {on ? <Text style={{ color: '#fff', fontSize: 14, fontWeight: '900' }}>✓</Text> : null}
    </View>
  )
}

/**
 * A small fact. Rendered as plain text by default — a row of coloured capsules
 * turns a docket into a dashboard, and the rider is not reading a dashboard.
 */
export function Pill({ text, tone = 'neutral' }: {
  text: string
  tone?: 'neutral' | 'dark' | 'green' | 'amber' | 'red'
}) {
  const fg =
    tone === 'red' ? C.red
    : tone === 'amber' ? C.amber
    : tone === 'green' ? C.green
    : tone === 'dark' ? C.ink
    : C.muted
  return (
    <Text style={{ fontSize: 14, fontWeight: tone === 'neutral' ? '500' : '700', color: fg }}>
      {text}
    </Text>
  )
}

/** Cash to collect. The one number a rider is personally answerable for. */
export function Money({ paise, mode }: { paise: number | null; mode: string | null }) {
  const cod = mode === 'COD'
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={s.label}>{cod ? 'COLLECT CASH' : 'PAYMENT'}</Text>
      <Text style={{
        fontSize: cod ? 24 : 16,
        fontWeight: cod ? '800' : '600',
        color: cod ? C.amber : C.green,
      }}>
        {cod ? (paise === null ? 'Ask the shop' : `₹${Math.round(paise / 100)}`) : 'Already paid'}
      </Text>
    </View>
  )
}

/**
 * Two tabs: work to do, and work done. Two is the most this app should have.
 *
 * Words and a rule under the active one. No pictograms — a parcel and a tick
 * read as decoration at this size, and the words are shorter than the time
 * spent decoding them.
 */
export type TabKey = 'orders' | 'delivery' | 'done'

export function TabBar({ tab, onChange }: {
  tab: TabKey
  onChange: (t: TabKey) => void
  badge?: number
}) {
  const items = [
    { key: 'orders' as const, label: 'Orders', icon: Store },
    { key: 'delivery' as const, label: 'Delivery', icon: Send },
    { key: 'done' as const, label: 'Delivered', icon: CheckCircle2 },
  ]
  return (
    <View style={{
      flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E5E7EB',
      backgroundColor: '#FFFFFF', paddingBottom: 24, paddingTop: 10, paddingHorizontal: 12,
      gap: 6
    }}>
      {items.map((it) => {
        const on = tab === it.key
        const Icon = it.icon
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            style={({ pressed }) => [{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              paddingVertical: 10, borderRadius: 12,
              backgroundColor: on ? '#EEF3FF' : 'transparent',
              gap: 6,
              opacity: pressed ? 0.6 : 1
            }]}
          >
            <Icon size={18} color={on ? '#2457D6' : '#686B76'} />
            <Text style={{
              fontSize: 14, fontWeight: on ? '700' : '600',
              color: on ? '#2457D6' : '#686B76'
            }}>
              {it.label}
            </Text>
          </Pressable>
        )
      })}
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

export function dateIST(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
  })
}

/** "in 25 min" / "TRAIN IS HERE" — the only clock a rider needs. */
export function untilLabel(iso: string | null): { text: string; urgent: boolean } {
  if (!iso) return { text: 'Time not known', urgent: false }
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (mins <= 0) return { text: 'Train is here', urgent: true }
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
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    padding: 18,
    marginBottom: 14,
  },
  // A filled ground means one thing only: the rider picked this one.
  cardSelected: { borderColor: C.ink, backgroundColor: C.subtle },

  button: {
    borderRadius: 10,
    minHeight: 50,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonHero: { minHeight: 54 },
  buttonText: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  buttonTextHero: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  seatText: { color: C.ink, fontSize: 22, fontWeight: '700', letterSpacing: 0.5 },
  seatTextHuge: { fontSize: 44, fontWeight: '800', letterSpacing: 1 },

  check: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 1.5, borderColor: C.faint, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },

  callBtn: {
    minHeight: 40, paddingHorizontal: 14, borderRadius: 8,
    borderWidth: 1, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },

  h1: { fontSize: 22, fontWeight: '700', color: C.ink },
  h2: { fontSize: 17, fontWeight: '600', color: C.ink },

  /** Small caps over a fact. The workhorse of the whole layout. */
  label: {
    fontSize: 11, fontWeight: '700', color: C.faint,
    letterSpacing: 1.2,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.faint,
    letterSpacing: 1.2, marginBottom: 14,
  },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  train: { fontSize: 16, fontWeight: '700', color: C.ink },

  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: '#fff',
    color: C.ink,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: C.line,
    backgroundColor: '#fff',
    paddingBottom: 12,
  },
  tab: { flex: 1, alignItems: 'center', minHeight: 48 },
  tabMark: { height: 2, width: 40, backgroundColor: 'transparent' },
})
