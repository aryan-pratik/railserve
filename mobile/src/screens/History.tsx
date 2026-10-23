import React, { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import type { HistoryOrder, HistoryQuery, HistoryResponse, Outcome } from '../types'
import { Button, C, Person, Rule, SearchBox, Seat, dateIST, rupees, s, timeIST } from '../ui'

/**
 * What this rider has already finished.
 *
 * The work list drops an order the moment it is closed, which is right for
 * getting through a shift and wrong at the end of one: the rider needs to
 * answer "did I deliver that one?" and, more importantly, hand over the right
 * cash. So the cash they are holding is the first thing on the screen — it is
 * the number they are personally accountable for, and it runs across days
 * until a store manager takes it.
 *
 * The list shows the last 48 hours by default; anything older is one date
 * away. Search reaches every order the rider ever finished.
 *
 * For 30 hours after an order closes the rider can still change how it ended,
 * and sees the passenger's full number. After that the number is masked by
 * the server and the record is final.
 */

const OUTCOME_LABEL: Record<Outcome, string> = {
  DELIVERED: 'Delivered',
  FAILED: 'Not delivered',
  CANCELLED: 'Cancelled',
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Today's date in IST as YYYY-MM-DD. */
function todayIST(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function dateLabel(date: string): string {
  const today = todayIST()
  if (date === today) return 'Today'
  if (date === shiftDate(today, -1)) return 'Yesterday'
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
  })
}

function whenLabel(iso: string): string {
  return `${dateIST(iso)}, ${timeIST(iso)}`
}

export function HistoryScreen({
  data,
  query,
  onQueryChange,
  refreshing,
  onRefresh,
  busy,
  onCorrect,
}: {
  data: HistoryResponse | null
  query: HistoryQuery
  onQueryChange: (q: HistoryQuery) => void
  refreshing: boolean
  onRefresh: () => void
  busy: boolean
  onCorrect: (order: HistoryOrder, to: Outcome, reason: string | null) => void
}) {
  const orders = data?.orders ?? []
  const wallet = data?.wallet
  const [text, setText] = useState(query.q ?? '')
  const [editing, setEditing] = useState<string | null>(null)

  // Search as the rider types, without a request per keystroke.
  useEffect(() => {
    const q = text.trim()
    if (q === (query.q ?? '')) return
    const t = setTimeout(() => onQueryChange({ date: query.date, q: q || undefined }), 450)
    return () => clearTimeout(t)
  }, [text, query.q, query.date, onQueryChange])

  const searching = Boolean(query.q)
  const delivered = orders.filter((o) => o.status === 'DELIVERED')
  const cod = delivered.filter((o) => o.paymentMode === 'COD')
  const codPaise = cod.reduce((sum, o) => sum + (o.amountCollectedPaise ?? o.amountPaise ?? 0), 0)
  const online = delivered.length - cod.length
  const notDelivered = orders.length - delivered.length

  // Group by calendar day, preserving the server's newest-first order.
  const days: { label: string; items: HistoryOrder[] }[] = []
  for (const o of orders) {
    const at = o.closedAt ?? o.deliveredAt
    const label = at ? dateIST(at) : 'Earlier'
    const last = days[days.length - 1]
    if (last && last.label === label) last.items.push(o)
    else days.push({ label, items: [o] })
  }

  const periodLabel = searching
    ? `Results for “${query.q}”`
    : query.date
      ? dateLabel(query.date)
      : 'Last 48 hours'

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Cash first. It is the one number the rider is answerable for. */}
      <View style={{
        borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 18,
        backgroundColor: wallet && wallet.pendingPaise > 0 ? '#FFF7ED' : C.subtle,
      }}>
        <Text style={s.label}>CASH WITH YOU</Text>
        <Text style={{
          fontSize: 32, fontWeight: '800', marginTop: 8,
          color: wallet && wallet.pendingPaise > 0 ? C.amber : C.ink,
        }}>
          {rupees(wallet?.pendingPaise ?? 0)}
        </Text>
        <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
          {wallet && wallet.pendingOrders > 0
            ? `${wallet.pendingOrders} COD order${wallet.pendingOrders === 1 ? '' : 's'} not handed over yet`
            : 'All cash handed over'}
        </Text>
        {wallet?.lastSettlement ? (
          <Text style={{ fontSize: 13, color: C.faint, marginTop: 6 }}>
            Last handed over {rupees(wallet.lastSettlement.paise)} · {whenLabel(wallet.lastSettlement.at)}
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: 20 }}>
        <SearchBox value={text} onChange={setText} onSubmit={() => onQueryChange({ date: query.date, q: text.trim() || undefined })} />
      </View>

      {/* Which day. Last 48 hours by default; older days one tap back each. */}
      {!searching ? (
        <View style={[s.row, { marginTop: 14, justifyContent: 'space-between' }]}>
          <Pressable
            onPress={() => onQueryChange({})}
            style={({ pressed }) => [chip(!query.date), { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: !query.date }}
          >
            <Text style={chipText(!query.date)}>Last 48 h</Text>
          </Pressable>

          <View style={[s.row, { gap: 4 }]}>
            <Pressable
              onPress={() => onQueryChange({ date: shiftDate(query.date ?? todayIST(), -1) })}
              hitSlop={8}
              accessibilityLabel="Earlier day"
              style={({ pressed }) => [stepBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <ChevronLeft size={18} color={C.ink} />
            </Pressable>
            <Pressable
              onPress={() => onQueryChange({ date: query.date ?? todayIST() })}
              style={({ pressed }) => [chip(Boolean(query.date)), { opacity: pressed ? 0.7 : 1, minWidth: 120 }]}
              accessibilityRole="button"
            >
              <Text style={[chipText(Boolean(query.date)), { textAlign: 'center' }]}>
                {query.date ? dateLabel(query.date) : 'Pick a date'}
              </Text>
            </Pressable>
            <Pressable
              disabled={!query.date || query.date >= todayIST()}
              onPress={() => query.date && onQueryChange({ date: shiftDate(query.date, 1) })}
              hitSlop={8}
              accessibilityLabel="Later day"
              style={({ pressed }) => [stepBtn, {
                opacity: !query.date || query.date >= todayIST() ? 0.3 : pressed ? 0.6 : 1,
              }]}
            >
              <ChevronRight size={18} color={C.ink} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* The period's record: how many, and how they were paid. */}
      <Text style={[s.label, { marginTop: 22 }]}>{periodLabel.toUpperCase()}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, rowGap: 16 }}>
        <Stat value={String(orders.length)} label="orders" />
        <Stat value={String(cod.length)} label={`COD · ${rupees(codPaise)}`} tone={C.amber} />
        <Stat value={String(online)} label="online / prepaid" tone={C.green} />
        <Stat value={String(notDelivered)} label="not delivered / cancelled" tone={notDelivered ? C.red : undefined} />
      </View>

      <View style={{ height: 24 }} />

      {orders.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 60 }}>
          <Text style={s.h2}>{searching ? 'No matching orders' : 'Nothing here'}</Text>
          <Text style={[s.muted, { marginTop: 8, textAlign: 'center' }]}>
            {searching
              ? 'Try another phone number, order id or name.'
              : query.date
                ? 'No orders finished on this day.'
                : 'Orders you finish show here for 48 hours.\nPick a date to see older days.'}
          </Text>
        </View>
      ) : null}

      {days.map((day, di) => (
        <View key={day.label}>
          <Text style={[s.sectionLabel, { marginTop: di === 0 ? 0 : 30, marginBottom: 0 }]}>
            {day.label.toUpperCase()}
          </Text>

          {day.items.map((o) => (
            <HistoryRow
              key={o.id}
              order={o}
              editing={editing === o.id}
              busy={busy}
              onEdit={() => setEditing(editing === o.id ? null : o.id)}
              onSave={(to, reason) => {
                setEditing(null)
                onCorrect(o, to, reason)
              }}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function HistoryRow({
  order: o,
  editing,
  busy,
  onEdit,
  onSave,
}: {
  order: HistoryOrder
  editing: boolean
  busy: boolean
  onEdit: () => void
  onSave: (to: Outcome, reason: string | null) => void
}) {
  const [to, setTo] = useState<Outcome | null>(null)
  const [reason, setReason] = useState('')
  const tone = o.status === 'DELIVERED' ? C.green : C.red
  const choices = (['DELIVERED', 'FAILED', 'CANCELLED'] as const).filter((c) => c !== o.status)
  const at = o.closedAt ?? o.deliveredAt

  return (
    <View>
      <Rule style={{ marginTop: 14 }} />
      <View style={{ paddingVertical: 18 }}>
        <View style={[s.row, { justifyContent: 'space-between', alignItems: 'baseline' }]}>
          <Seat coach={o.coach} berth={o.berth} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: tone }}>{OUTCOME_LABEL[o.status]}</Text>
        </View>

        <View style={{ marginTop: 14 }}>
          <Person name={o.contactName} phone={o.contactPhone} compact noCall={o.phoneMasked} />
        </View>

        <Text style={{ fontSize: 14, color: C.muted, marginTop: 12 }} numberOfLines={1}>
          {o.externalOrderId ? `#${o.externalOrderId}   ·   ` : ''}
          {o.trainNo ?? '—'}
          {`   ·   ${timeIST(at ?? null)}`}
        </Text>

        <Text style={{ fontSize: 14, color: C.muted, marginTop: 5 }}>
          {o.status !== 'DELIVERED'
            ? o.paymentMode === 'COD' ? `COD ${rupees(o.amountPaise)} · no cash` : 'Prepaid'
            : o.paymentMode === 'COD'
              ? `COD · ${rupees(o.amountCollectedPaise ?? o.amountPaise)} collected`
              : 'Online · prepaid'}
          {o.receivedBy ? `   ·   Taken by ${o.receivedBy}` : ''}
        </Text>

        {o.codSettledAt ? (
          <Text style={{ fontSize: 13, color: C.green, marginTop: 5, fontWeight: '600' }}>
            Cash handed over · {whenLabel(o.codSettledAt)}
          </Text>
        ) : null}

        {o.status !== 'DELIVERED' && o.failureReason ? (
          <Text style={{ fontSize: 14, color: C.red, marginTop: 8, lineHeight: 20 }}>{o.failureReason}</Text>
        ) : null}

        {o.editableUntil ? (
          <Pressable onPress={onEdit} hitSlop={8} style={{ marginTop: 12, alignSelf: 'flex-start' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: C.accent }}>
              {editing ? 'Close' : 'Change status'}
            </Text>
            <Text style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              Until {whenLabel(o.editableUntil)}
            </Text>
          </Pressable>
        ) : null}

        {editing ? (
          <View style={{ marginTop: 14, gap: 10 }}>
            <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
              {choices.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setTo(c)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: to === c }}
                  style={({ pressed }) => [chip(to === c), { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={chipText(to === c)}>{OUTCOME_LABEL[c]}</Text>
                </Pressable>
              ))}
            </View>
            {to && to !== 'DELIVERED' ? (
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder={to === 'CANCELLED' ? 'Why was it cancelled?' : 'What happened?'}
                placeholderTextColor={C.faint}
                multiline
                style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]}
              />
            ) : null}
            <Button
              label={to ? `Mark ${OUTCOME_LABEL[to].toLowerCase()}` : 'Choose a status'}
              tone={to === 'DELIVERED' ? 'success' : 'danger'}
              busy={busy}
              disabled={!to || (to !== 'DELIVERED' && !reason.trim())}
              onPress={() => to && onSave(to, to === 'DELIVERED' ? null : reason.trim())}
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <View style={{ width: '50%', paddingRight: 8 }}>
      <Text style={{ fontSize: 26, fontWeight: '800', color: tone ?? C.ink }}>{value}</Text>
      <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{label}</Text>
    </View>
  )
}

const stepBtn = {
  width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line,
  alignItems: 'center' as const, justifyContent: 'center' as const,
}

function chip(on: boolean) {
  return {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1,
    borderColor: on ? '#2457D6' : C.line,
    backgroundColor: on ? '#EEF3FF' : '#fff',
  }
}

function chipText(on: boolean) {
  return { fontSize: 14, fontWeight: on ? ('700' as const) : ('600' as const), color: on ? '#2457D6' : C.muted }
}
