import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'
import { ApiError, fetchTeam, receiveTeamCash } from '../api'
import type { TeamMember, TeamResponse } from '../types'
import { C, dateIST, rupees, timeIST } from '../ui'

/**
 * A team leader's riders: what each has done in the reporting day, what is
 * in their hands, and the cash they are holding.
 *
 * These are the numbers each rider sees on their own Done tab and the office
 * sees on its Riders page, from one ledger. Shown only to a team leader: the
 * server answers 403 for anyone else, and then this draws nothing.
 *
 * When an admin has authorised the leader to receive cash, a rider's row
 * offers it. It is sent at once and never queued, and it names the orders the
 * leader was shown, so cash delivered since the list loaded is not marked
 * received without having been counted.
 */
export function TeamSection({ token, active }: { token: string; active: boolean }) {
  const [team, setTeam] = useState<TeamResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTeam(await fetchTeam(token))
    } catch (err) {
      // 403: not a team leader. Anything else: leave what was there.
      if (err instanceof ApiError && err.status === 403) setTeam(null)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (active) void load()
  }, [active, load])

  if (!team) {
    return loading ? <ActivityIndicator style={{ marginBottom: 18 }} color={C.accent} /> : null
  }

  function receive(m: TeamMember) {
    Alert.alert(
      `Receive ${rupees(m.due.paise)} from ${m.name}?`,
      `${m.due.orders} COD order${m.due.orders === 1 ? '' : 's'}. Count the cash first: this cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Received',
          onPress: async () => {
            setBusy(m.id)
            setNote(null)
            try {
              const r = await receiveTeamCash(token, m.id, m.due.orderIds)
              setNote(`Received ${rupees(r.paise)} from ${m.name}.`)
            } catch (err) {
              setNote(err instanceof Error ? err.message : 'Could not record it. Try again.')
            } finally {
              setBusy(null)
              void load()
            }
          },
        },
      ],
    )
  }

  const totalDue = team.members.reduce((a, m) => a + m.due.paise, 0)

  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={label}>MY TEAM · {team.members.length - 1} RIDER{team.members.length === 2 ? '' : 'S'}</Text>
      <View style={card}>
        <Text style={{ fontSize: 13, color: C.muted }}>
          Today, 3 am to 3 am. Cash due is across all days: {rupees(totalDue)} with the team.
        </Text>
        {note ? <Text style={{ fontSize: 13, color: C.accent, marginTop: 8, fontWeight: '600' }}>{note}</Text> : null}

        {team.members.map((m) => (
          <View key={m.id} style={{ borderTopWidth: 1, borderTopColor: '#F0F2F5', marginTop: 14, paddingTop: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink, flex: 1 }} numberOfLines={1}>
                {m.name}{m.isLead ? ' (you)' : ''}
              </Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: m.due.paise > 0 ? C.amber : C.faint }}>
                {rupees(m.due.paise)}
              </Text>
            </View>
            <Text style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
              {m.day.delivered} delivered · {m.day.notDelivered + m.day.cancelled} not · {m.now.inHand} in hand
              {m.now.waiting ? ` · ${m.now.waiting} to pick up` : ''}
            </Text>
            <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
              COD today {rupees(m.day.codPaise)} ({m.day.codOrders}) · due {m.due.orders} order{m.due.orders === 1 ? '' : 's'}
            </Text>
            <Text style={{ fontSize: 12, color: C.faint, marginTop: 2 }} numberOfLines={1}>
              {m.lastCollection
                ? `Last handed in ${rupees(m.lastCollection.paise)} · ${dateIST(m.lastCollection.at)}, ${timeIST(m.lastCollection.at)}${m.lastCollection.receivedBy ? ` · to ${m.lastCollection.receivedBy}` : ''}`
                : 'Has never handed cash in'}
            </Text>
            {team.lead.canReceiveCash && !m.isLead && m.due.paise > 0 ? (
              <Pressable
                onPress={() => receive(m)}
                disabled={busy !== null}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  marginTop: 10, alignSelf: 'flex-start', borderRadius: 10, borderWidth: 1, borderColor: C.accent,
                  paddingHorizontal: 14, paddingVertical: 9, opacity: busy !== null ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: C.accent }}>
                  {busy === m.id ? 'Recording…' : `Receive ${rupees(m.due.paise)}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}

const label = {
  fontSize: 11, fontWeight: '700' as const, color: '#686B76', letterSpacing: 1.1,
  marginBottom: 10, marginLeft: 4,
}
const card = {
  backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', padding: 18,
}
