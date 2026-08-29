import React from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'

/**
 * Primitives for the rider app.
 *
 * Built for someone standing on a platform with one hand free, in daylight,
 * under time pressure, who may not read English comfortably. That drives every
 * choice here: touch targets never below 56px, numbers far larger than the
 * words around them, and colour used to mean one thing consistently — indigo
 * is a choice, green is go, amber is money, red is a problem.
 *
 * Depth comes from a single soft shadow rather than borders. Borders are kept
 * for one job only: marking a card the rider has selected.
 */
export const C = {
  bg: '#f4f5f7',
  card: '#ffffff',
  line: '#e4e7ec',
  ink: '#101828',
  muted: '#475467',
  faint: '#98a2b3',
  accent: '#4f46e5',
  accentSoft: '#eef2ff',
  green: '#039855',
  greenSoft: '#ecfdf3',
  amber: '#b54708',
  amberSoft: '#fffaeb',
  red: '#d92d20',
  redSoft: '#fef3f2',
}

/** One soft shadow, used everywhere, so nothing looks arbitrarily different. */
const SHADOW = {
  shadowColor: '#101828',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
}

export function Card({
  children,
  style,
  selected,
}: {
  children: React.ReactNode
  style?: object
  selected?: boolean
}) {
  return (
    <View style={[s.card, selected && s.cardSelected, style]}>{children}</View>
  )
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
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
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
 * else on the card is context.
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

/**
 * Who to hand the food to, and how to reach them.
 *
 * On the card rather than one tap further in, because a rider who arrives at
 * an empty berth needs the phone number right then — going back into a detail
 * screen to find it is the moment the train leaves.
 */
export function Person({ name, phone, compact }: {
  name: string | null
  phone: string | null
  compact?: boolean
}) {
  if (!name && !phone) return null
  return (
    <View style={[s.row, { justifyContent: 'space-between', gap: 10 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ fontSize: compact ? 16 : 17, fontWeight: '700', color: C.ink }}
          numberOfLines={1}
        >
          {name ?? 'Name not given'}
        </Text>
        {phone ? (
          <Text style={{ fontSize: 14, color: C.muted, marginTop: 1 }}>{phone}</Text>
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
      hitSlop={8}
      style={({ pressed }) => [
        s.callBtn,
        wide && { alignSelf: 'stretch', justifyContent: 'center' },
        { opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={{ fontSize: 16, fontWeight: '800', color: C.accent }}>
        📞{wide ? '  Call passenger' : ''}
      </Text>
    </Pressable>
  )
}

/**
 * A tick box big enough to hit while walking.
 *
 * Selection is the whole point of the pickup list — a rider takes the five
 * orders they can carry, not all forty — so this is a 32px target inside a
 * row that is itself pressable.
 */
export function Check({ on }: { on: boolean }) {
  return (
    <View style={[s.check, on && { backgroundColor: C.accent, borderColor: C.accent }]}>
      {on ? <Text style={{ color: '#fff', fontSize: 17, fontWeight: '900' }}>✓</Text> : null}
    </View>
  )
}

/** Small labelled chip: platform, delay, status. */
export function Pill({ text, tone = 'neutral' }: {
  text: string
  tone?: 'neutral' | 'dark' | 'green' | 'amber' | 'red'
}) {
  const map = {
    neutral: { bg: C.bg, fg: C.muted },
    dark: { bg: C.ink, fg: '#ffffff' },
    green: { bg: C.greenSoft, fg: C.green },
    amber: { bg: C.amberSoft, fg: C.amber },
    red: { bg: C.redSoft, fg: C.red },
  }[tone]
  return (
    <View style={[s.pill, { backgroundColor: map.bg }]}>
      <Text style={{ color: map.fg, fontWeight: '800', fontSize: 13 }}>{text}</Text>
    </View>
  )
}

/** Cash to collect. Loud when there is money, quiet when there is not. */
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

/**
 * Two tabs, labelled in words as well as icons.
 *
 * Two is the most this app should ever have: work to do, and work done.
 */
export function TabBar({ tab, onChange, badge }: {
  tab: 'jobs' | 'done'
  onChange: (t: 'jobs' | 'done') => void
  badge?: number
}) {
  const items = [
    { key: 'jobs' as const, icon: '📦', label: 'My work' },
    { key: 'done' as const, icon: '✅', label: 'Delivered' },
  ]
  return (
    <View style={s.tabBar}>
      {items.map((it) => {
        const on = tab === it.key
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            style={({ pressed }) => [s.tab, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ fontSize: 22 }}>{it.icon}</Text>
            <Text style={{
              fontSize: 12, fontWeight: '800', marginTop: 2,
              color: on ? C.accent : C.faint,
            }}>
              {it.label}
              {it.key === 'jobs' && badge ? ` (${badge})` : ''}
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
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    ...SHADOW,
  },
  // A border means one thing only: the rider picked this one.
  cardSelected: { borderWidth: 2, borderColor: C.accent, backgroundColor: C.accentSoft },

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
    paddingVertical: 9,
    paddingHorizontal: 13,
    alignSelf: 'flex-start',
  },
  seatHuge: { paddingVertical: 18, paddingHorizontal: 28, borderRadius: 20 },
  seatText: { color: '#fff', fontSize: 21, fontWeight: '800', letterSpacing: 1 },
  seatTextHuge: { fontSize: 46, letterSpacing: 2 },

  check: {
    width: 32, height: 32, borderRadius: 10,
    borderWidth: 2, borderColor: C.line, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },

  callBtn: {
    minWidth: 48, minHeight: 44, paddingHorizontal: 12,
    borderRadius: 12, backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },

  pill: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },

  moneyBox: { borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18, alignItems: 'center' },
  moneyLabel: { fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },
  moneySub: { fontSize: 13, fontWeight: '600', marginTop: 2 },

  h1: { fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink },
  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: C.faint,
    letterSpacing: 1.2, marginBottom: 10, marginTop: 4,
  },
  muted: { color: C.muted, fontSize: 14 },
  train: { fontSize: 20, fontWeight: '800', color: C.ink, letterSpacing: 0.3 },

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

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: C.line,
    backgroundColor: '#fff',
    paddingTop: 8, paddingBottom: 10,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
})
