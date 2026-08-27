import React from 'react'
import { RefreshControl, ScrollView, Text, Pressable, View } from 'react-native'
import type { Run, RunsResponse } from '../types'
import { C, Card, Pill, delayLabel, s, timeIST } from '../ui'

export function RunsScreen({
  data, offline, refreshing, onRefresh, onOpen, queueSize,
}: {
  data: RunsResponse | null
  offline: boolean
  refreshing: boolean
  onRefresh: () => void
  onOpen: (run: Run) => void
  queueSize: number
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={s.h1}>My runs</Text>
      <Text style={[s.muted, { marginTop: 2, marginBottom: 14 }]}>
        {data ? data.serviceDate : 'Loading…'}
        {offline && data ? '  ·  showing saved copy' : ''}
      </Text>

      {offline ? (
        <Card style={{ backgroundColor: C.amberBg, borderColor: '#fcd34d' }}>
          <Text style={{ color: C.amber, fontWeight: '700' }}>No connection</Text>
          <Text style={{ color: C.amber, marginTop: 2, fontSize: 13 }}>
            {queueSize > 0
              ? `${queueSize} update${queueSize === 1 ? '' : 's'} saved on this phone. They will sync on their own.`
              : 'You can still open runs and record deliveries.'}
          </Text>
        </Card>
      ) : queueSize > 0 ? (
        <Card style={{ backgroundColor: C.slateBg }}>
          <Text style={{ color: C.muted, fontSize: 13 }}>Syncing {queueSize} update(s)…</Text>
        </Card>
      ) : null}

      {data?.runs.length === 0 ? (
        <Card>
          <Text style={s.h2}>No runs assigned today</Text>
          <Text style={[s.muted, { marginTop: 4 }]}>
            Runs appear once the office assigns you to orders. Pull down to refresh.
          </Text>
        </Card>
      ) : null}

      {data?.runs.map((run) => {
        const ready = run.statusCounts.PREPARED ?? 0
        const out = run.statusCounts.DISPATCHED ?? 0
        const cooking =
          (run.statusCounts.RECEIVED ?? 0) +
          (run.statusCounts.ACCEPTED ?? 0) +
          (run.statusCounts.KOT_PRINTED ?? 0)
        const delay = delayLabel(run.timing.delayMinutes)

        return (
          <Pressable key={run.key} onPress={() => onOpen(run)}>
            <Card>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.h2}>{run.trainNo ?? 'No train no.'}</Text>
                <Text style={{ fontWeight: '700', color: C.ink }}>
                  {timeIST(run.timing.effectiveArrival)}
                </Text>
              </View>
              <Text style={[s.muted, { marginTop: 2 }]}>{run.trainName}</Text>

              <View style={[s.row, { marginTop: 10, flexWrap: 'wrap' }]}>
                <Pill
                  label={run.timing.source}
                  bg={run.timing.source === 'LIVE' ? C.greenBg : C.slateBg}
                  fg={run.timing.source === 'LIVE' ? C.green : C.muted}
                />
                {delay ? (
                  <Pill
                    label={delay}
                    bg={delay === 'on time' ? C.greenBg : C.amberBg}
                    fg={delay === 'on time' ? C.green : C.amber}
                  />
                ) : null}
                <Pill
                  label={run.timing.platform ? `PF ${run.timing.platform}` : 'PF ?'}
                  bg={C.dark}
                  fg="#fff"
                />
                {run.timing.stale && run.timing.ageMinutes !== null ? (
                  <Pill label={`as of ${run.timing.ageMinutes}m ago`} />
                ) : null}
              </View>

              <Text style={[s.muted, { marginTop: 10 }]}>
                {run.stationCode} · {run.orders.length} order{run.orders.length === 1 ? '' : 's'}
              </Text>

              <View style={[s.row, { marginTop: 8, flexWrap: 'wrap' }]}>
                {ready > 0 ? <Pill label={`${ready} ready`} bg={C.amberBg} fg={C.amber} /> : null}
                {out > 0 ? <Pill label={`${out} out`} bg="#ffedd5" fg="#c2410c" /> : null}
                {cooking > 0 ? <Pill label={`${cooking} cooking`} /> : null}
              </View>
            </Card>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
