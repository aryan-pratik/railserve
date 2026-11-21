import type { AuthContext } from '@/lib/authContext'
import { Card, Chip, Mono } from '@/components/v2/ui'
import { KeyValue, Notice } from '@/components/v2/Table'
import { agentPresence, loadIntegrations, relativeAgo, relativeUntil, type loadSetupBase } from '@/lib/v2/settings'
import { formatIST } from '@/lib/format'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

/**
 * Read-only health of everything this installation talks to. Env is read on
 * the server and only "set or not", provider names and a masked number reach
 * the page.
 */
export async function IntegrationsTab({ ctx, base, now }: { ctx: AuthContext; base: Base; now: Date }) {
  const s = await loadIntegrations(ctx, now)
  const nowMs = now.getTime()
  const g = s.gmail

  const gmailChip = !g.configured ? { tone: 'grey' as const, label: 'Not connected' } : g.stale ? { tone: 'bad' as const, label: 'Stalled' } : { tone: 'ok' as const, label: 'Connected' }
  const watchExpired = g.watchExpiresIso ? new Date(g.watchExpiresIso).getTime() < nowMs : false

  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <Card title="Gmail" action={<Chip tone={gmailChip.tone}>{gmailChip.label}</Chip>}>
        {g.configured && watchExpired ? (
          <Notice tone="bad">Gmail stopped pushing new mail when the watch expired {relativeAgo(nowMs - new Date(g.watchExpiresIso!).getTime())}. Orders stay in the mailbox until the cron renews it.</Notice>
        ) : g.configured && g.stale && g.staleMessage ? (
          <Notice tone="bad">{g.staleMessage}</Notice>
        ) : null}
        <KeyValue
          rows={[
            { label: 'Mailbox', value: g.configured ? (g.address ?? <span className="text-v2-muted">address not named in env</span>) : <span className="text-v2-muted">credentials not set; orders are pasted by hand</span> },
            {
              label: 'Push watch',
              value: g.watchExpiresIso ? (
                <span className={watchExpired ? 'font-semibold text-v2-bad' : ''}>
                  {watchExpired ? relativeUntil(g.watchExpiresIso, nowMs) : `expires ${relativeUntil(g.watchExpiresIso, nowMs)}`} · {formatIST(g.watchExpiresIso)}
                </span>
              ) : (
                <span className="text-v2-muted">never registered</span>
              ),
            },
            { label: 'Last renewal', value: g.lastRenewalIso ? formatIST(g.lastRenewalIso) : <span className="text-v2-muted">—</span> },
            {
              label: 'Last order mail',
              value: g.lastMessageIso ? `${formatIST(g.lastMessageIso)} · ${relativeAgo(nowMs - new Date(g.lastMessageIso).getTime())}` : <span className="text-v2-muted">none yet</span>,
            },
            { label: 'Last error', value: g.lastError ? <span className="break-words text-v2-bad">{g.lastError}</span> : <span className="text-v2-muted">none</span> },
          ]}
        />
      </Card>

      <Card title="WhatsApp" action={<Chip tone={s.whatsapp.simulated ? 'grey' : 'ok'}>{s.whatsapp.simulated ? 'Simulator' : 'Live'}</Chip>}>
        <KeyValue
          rows={[
            { label: 'Provider', value: s.whatsapp.simulated ? 'Simulator: every message is answered by a fake passenger' : 'MSG91 WhatsApp Business API' },
            { label: 'Business number', value: s.whatsapp.numberMasked ? <Mono>{s.whatsapp.numberMasked}</Mono> : <span className="text-v2-muted">not set</span> },
            { label: 'Opener template', value: s.whatsapp.openerTemplate ? <Mono>{s.whatsapp.openerTemplate}</Mono> : <span className="text-v2-muted">not set</span> },
          ]}
        />
      </Card>

      <Card title="Train status" action={<Chip tone={s.train.simulated ? 'grey' : s.train.failing ? 'bad' : 'ok'}>{s.train.simulated ? 'Simulated' : s.train.failing ? 'Failing' : 'Live'}</Chip>}>
        {s.train.failing && s.train.message ? <Notice tone="bad">{s.train.message}</Notice> : null}
        <KeyValue
          rows={[
            { label: 'Provider', value: <span className="capitalize">{s.train.provider}</span> },
            { label: 'Last 2 hours', value: s.train.trainsTried ? `${s.train.trainsTried} train${s.train.trainsTried === 1 ? '' : 's'} polled` : <span className="text-v2-muted">nothing needed polling</span> },
            ...(s.train.failingTrains.length
              ? [{ label: 'Failing trains', value: <span className="flex flex-wrap gap-1">{s.train.failingTrains.map((t) => <Mono key={t}>{t}</Mono>)}</span> }]
              : []),
          ]}
        />
      </Card>

      <Card title="Proof photos" action={<Chip tone={s.storage.configured ? 'ok' : 'grey'}>{s.storage.configured ? 'Configured' : 'Off'}</Chip>}>
        <KeyValue
          rows={[
            { label: 'Storage', value: s.storage.configured ? 'Cloudflare R2 (S3 API)' : <span className="text-v2-muted">no bucket; riders cannot attach a photo</span> },
            { label: 'Bucket', value: s.storage.bucket ? <Mono>{s.storage.bucket}</Mono> : <span className="text-v2-muted">—</span> },
          ]}
        />
      </Card>

      <Card title="Print agents" className="md:col-span-2">
        {base.stations.length === 0 ? (
          <p className="text-sm text-v2-muted">No stations yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {base.stations.map((st) => {
              const agent = agentPresence(st.agentLastSeenIso, nowMs)
              const chip = st.directPrinterHost
                ? { tone: 'ok' as const, label: 'Direct' }
                : !st.hasAgentToken
                  ? { tone: 'grey' as const, label: 'No agent' }
                  : agent.online
                    ? { tone: 'ok' as const, label: 'Online' }
                    : { tone: 'warn' as const, label: 'Offline' }
              return (
                <div key={st.code} className="grid gap-1.5 rounded-v2-md border border-v2-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      <Mono>{st.code}</Mono>
                      {st.name ? <span className="ml-1.5 text-[13px] font-medium text-v2-muted">{st.name}</span> : null}
                    </span>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  </div>
                  <div className="text-xs text-v2-muted">
                    {st.directPrinterHost ? (
                      <>
                        Server prints over TCP to <Mono>{st.directPrinterHost}:{st.directPrinterPort}</Mono>
                      </>
                    ) : st.hasAgentToken ? (
                      <>Agent {agent.label}</>
                    ) : (
                      'No print token issued for this station'
                    )}
                  </div>
                  {st.agentLastPrintedIso ? <div className="text-xs text-v2-muted">Last printed {formatIST(st.agentLastPrintedIso)}</div> : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
