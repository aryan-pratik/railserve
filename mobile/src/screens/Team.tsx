import React, { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { receiveTeamCash } from '../api'
import type { TeamDueOrder, TeamMember, TeamResponse } from '../types'
import { C, dateIST, rupees, timeIST } from '../ui'

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
}

/**
 * A team leader's own tab: the riders under them, the cash each is holding,
 * and the handovers already made.
 *
 * It has a tab to itself because collecting cash is a job, like picking up
 * and delivering, and a leader does it standing in front of a rider with
 * money in hand: it should not be three taps deep in a profile sheet.
 *
 * Two views. "To collect" lists every rider with what they did today and the
 * cash they hold; a rider's row opens to the orders that cash is on, so it
 * can be taken all at once or one order at a time. "History" lists the
 * team's handovers, newest first, with who received each.
 *
 * Receiving is sent at once and never queued, and it names the orders the
 * leader was shown: cash delivered since the list loaded is not marked
 * received without having been counted. The figures are the rider ledger's,
 * the same ones each rider and the office see.
 */
export function TeamScreen({
  team, token, refreshing, offline, onRefresh,
}: {
  team: TeamResponse
  token: string
  refreshing: boolean
  offline: boolean
  onRefresh: () => void
}) {
  const [view, setView] = useState<'collect' | 'history'>('collect')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)

  const riders = team.members.filter((m) => !m.isLead)
  const me = team.members.find((m) => m.isLead) ?? null
  const mayReceive = team.lead.canReceiveCash
  const toCollect = riders.reduce((a, m) => a + m.due.paise, 0)
  const holding = riders.filter((m) => m.due.paise > 0).length
  const collections = team.collections ?? []
  const todayStart = team.day

  function receive(m: TeamMember, orders: TeamDueOrder[] | null) {
    const ids = orders ? orders.map((o) => o.id) : m.due.orderIds
    const paise = orders ? orders.reduce((a, o) => a + o.paise, 0) : m.due.paise
    const key = orders && orders.length === 1 ? orders[0].id : m.id
    Alert.alert(
      `Receive ${rupees(paise)} from ${m.name}?`,
      `${ids.length} COD order${ids.length === 1 ? '' : 's'}. Count the cash first: this cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Received',
          onPress: async () => {
            setBusy(key)
            setNote(null)
            try {
              const r = await receiveTeamCash(token, m.id, ids)
              setNote({ text: `Received ${rupees(r.paise)} from ${m.name}.`, ok: true })
            } catch (err) {
              setNote({ text: err instanceof Error ? err.message : 'Could not record it. Try again.', ok: false })
            } finally {
              setBusy(null)
              onRefresh()
            }
          },
        },
      ],
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>Team cash</Text>
        <Text style={{ fontSize: 13, color: colors.secondaryText, marginTop: 4 }}>
          {riders.length} rider{riders.length === 1 ? '' : 's'} · today is {dateIST(`${todayStart}T12:00:00+05:30`)}, 3 am to 3 am
        </Text>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Tile label="TO COLLECT" value={rupees(toCollect)} sub={`${holding} rider${holding === 1 ? '' : 's'} holding cash`} tone={toCollect > 0 ? C.amber : colors.text} />
          <Tile
            label="COD TODAY"
            value={rupees(riders.reduce((a, m) => a + m.day.codPaise, 0))}
            sub={`${riders.reduce((a, m) => a + m.day.delivered, 0)} delivered by the team`}
            tone={colors.text}
          />
        </View>

        {offline ? (
          <Text style={{ fontSize: 13, color: C.amber, fontWeight: '600', marginTop: 12 }}>
            No internet. These figures are from the last time the app was online, and cash cannot be received until it is back.
          </Text>
        ) : null}
        {!mayReceive ? (
          <Text style={{ fontSize: 13, color: colors.secondaryText, marginTop: 12 }}>
            You can see your team&apos;s cash but not receive it. An admin has to allow that for you.
          </Text>
        ) : null}
        {note ? (
          <Text style={{ fontSize: 14, fontWeight: '700', marginTop: 12, color: note.ok ? colors.success : C.red }}>
            {note.text}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', backgroundColor: '#ECEEF2', borderRadius: 12, padding: 4, marginTop: 16 }}>
          {([['collect', 'To collect'], ['history', `History${collections.length ? ` (${collections.length})` : ''}`]] as const).map(([k, l]) => (
            <Pressable
              key={k}
              onPress={() => setView(k)}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === k }}
              style={{
                flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center',
                backgroundColor: view === k ? colors.card : 'transparent',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: view === k ? '700' : '600', color: view === k ? colors.text : colors.secondaryText }}>
                {l}
              </Text>
            </Pressable>
          ))}
        </View>

        {view === 'collect' ? (
          <View style={{ marginTop: 14, gap: 12 }}>
            {riders.length === 0 ? (
              <Empty text="No riders have been put on your team yet. An admin does that from the office." />
            ) : null}
            {riders.map((m) => {
              const isOpen = open === m.id
              const orders = m.dueOrders ?? []
              return (
                <View key={m.id} style={card}>
                  <Pressable
                    onPress={() => setOpen(isOpen ? null : m.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.name}, ${rupees(m.due.paise)} to collect`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                        {m.name}{m.active ? '' : ' (inactive)'}
                      </Text>
                      <Text style={{ fontSize: 13, color: colors.secondaryText, marginTop: 3 }}>
                        {m.day.delivered} delivered · {m.day.notDelivered + m.day.cancelled} not · {m.now.inHand} in hand
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 17, fontWeight: '800', color: m.due.paise > 0 ? C.amber : C.faint }}>
                        {rupees(m.due.paise)}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.secondaryText, marginTop: 2 }}>
                        {m.due.orders ? `${m.due.orders} order${m.due.orders === 1 ? '' : 's'}` : 'nothing due'}
                      </Text>
                    </View>
                    {m.due.orders > 0 ? (
                      isOpen ? <ChevronUp size={18} color={colors.secondaryText} /> : <ChevronDown size={18} color={colors.secondaryText} />
                    ) : null}
                  </Pressable>

                  <Text style={{ fontSize: 12, color: C.faint, marginTop: 8 }} numberOfLines={1}>
                    {m.lastCollection
                      ? `Last handed in ${rupees(m.lastCollection.paise)} · ${dateIST(m.lastCollection.at)}, ${timeIST(m.lastCollection.at)}${m.lastCollection.receivedBy ? ` · to ${m.lastCollection.receivedBy}` : ''}`
                      : 'Has never handed cash in'}
                  </Text>

                  {mayReceive && m.due.paise > 0 ? (
                    <Pressable
                      onPress={() => receive(m, null)}
                      disabled={busy !== null || offline}
                      accessibilityRole="button"
                      style={({ pressed }) => ({
                        marginTop: 12, borderRadius: 12, backgroundColor: colors.primary, paddingVertical: 12,
                        alignItems: 'center', opacity: busy !== null || offline ? 0.5 : pressed ? 0.8 : 1,
                      })}
                    >
                      {busy === m.id ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                          Receive all {rupees(m.due.paise)}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}

                  {isOpen && m.due.orders > 0 ? (
                    <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
                      {orders.length === 0 ? (
                        <Text style={{ fontSize: 13, color: colors.secondaryText, paddingTop: 12 }}>
                          Pull down to refresh and see the orders.
                        </Text>
                      ) : null}
                      {orders.map((o) => (
                        <View key={o.id} style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11,
                          borderBottomWidth: 1, borderBottomColor: colors.borderLight,
                        }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                              {o.contactName?.trim() || 'Name not given'}
                            </Text>
                            <Text style={{ fontSize: 12, color: colors.secondaryText, marginTop: 2 }} numberOfLines={1}>
                              {[o.trainNo ? `Train ${o.trainNo}` : null, o.externalOrderId, o.deliveredAt ? `${dateIST(o.deliveredAt)}, ${timeIST(o.deliveredAt)}` : null]
                                .filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{rupees(o.paise)}</Text>
                          {mayReceive ? (
                            <Pressable
                              onPress={() => receive(m, [o])}
                              disabled={busy !== null || offline}
                              accessibilityRole="button"
                              accessibilityLabel={`Receive ${rupees(o.paise)} for this order`}
                              hitSlop={8}
                              style={({ pressed }) => ({
                                borderRadius: 9, borderWidth: 1, borderColor: colors.primary,
                                paddingHorizontal: 10, paddingVertical: 7,
                                opacity: busy !== null || offline ? 0.5 : pressed ? 0.7 : 1,
                              })}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                                {busy === o.id ? '…' : 'Receive'}
                              </Text>
                            </Pressable>
                          ) : (
                            <Status text="With rider" tone="amber" />
                          )}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              )
            })}

            {me ? (
              <View style={[card, { backgroundColor: colors.softBlue, borderColor: '#D9E4FF' }]}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>YOUR OWN CASH</Text>
                <Text style={{ fontSize: 15, color: colors.text, marginTop: 6 }}>
                  You are holding {rupees(me.due.paise)}
                  {me.due.orders ? ` on ${me.due.orders} order${me.due.orders === 1 ? '' : 's'}` : ''}.
                  A store manager or admin receives it from you.
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ marginTop: 14, gap: 10 }}>
            {collections.length === 0 ? <Empty text="No cash has been handed in by your team yet." /> : null}
            {collections.map((c) => (
              <View key={c.id} style={[card, { paddingVertical: 14 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }} numberOfLines={1}>{c.riderName}</Text>
                    <Text style={{ fontSize: 12, color: colors.secondaryText, marginTop: 3 }} numberOfLines={1}>
                      {dateIST(c.at)}, {timeIST(c.at)} · {c.orders} order{c.orders === 1 ? '' : 's'}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.secondaryText, marginTop: 2 }} numberOfLines={1}>
                      {c.receivedBy ? `Received by ${c.receivedBy}${c.receivedAs ? ` (${c.receivedAs})` : ''}` : 'Receiver not recorded'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{rupees(c.paise)}</Text>
                    <Status text="Received" tone="green" />
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <View style={[card, { flex: 1, padding: 14 }]}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.secondaryText, letterSpacing: 1 }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '800', color: tone, marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={{ fontSize: 12, color: colors.secondaryText, marginTop: 4 }} numberOfLines={1}>{sub}</Text>
    </View>
  )
}

function Status({ text, tone }: { text: string; tone: 'green' | 'amber' }) {
  const green = tone === 'green'
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: green ? colors.successBg : '#FFF4E0' }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: green ? colors.success : '#B45309' }}>{text}</Text>
    </View>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <View style={[card, { alignItems: 'center', paddingVertical: 28 }]}>
      <Text style={{ fontSize: 14, color: colors.secondaryText, textAlign: 'center' }}>{text}</Text>
    </View>
  )
}

const card = {
  backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16,
}
