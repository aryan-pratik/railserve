'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ButtonLink, Dash, FormNote, IconButton, PaymentBadge, StatusBadge, statusLabel } from '@/components/ui'
import { IconClose, IconPhone } from '@/components/Icons'
import { formatIST, formatMoney, formatTimeIST } from '@/lib/format'
import { adminTransitionAction, forceRefreshOrderTrain, type ActionState } from './orders/[id]/actions'
import { fetchOrderDetail, type OrderDetail } from './orderDetail'
import { RefreshTrainButton } from '@/components/RefreshTrainButton'

const initial: ActionState = {}

/** What the board already knows about a row, painted before the fetch lands. */
export type OrderPreview = {
  id: string
  externalOrderId: string
  status: string
  outletName: string | null
}

/**
 * Order detail, slid in from the right.
 *
 * A panel rather than a page because the board is the workspace: an admin
 * checks an order, acts on it, and carries on down the list.
 *
 * The header paints from the row that was clicked, so the panel is never
 * blank: the id, status and outlet are on screen the same frame it opens,
 * and the fetch fills in the rest underneath a skeleton.
 *
 * After a transition the board is refreshed too, or the row's status badge
 * quietly disagrees with the panel on top of it.
 */
export function OrderSlideOver({
  preview,
  onClose,
}: {
  preview: OrderPreview | null
  onClose: () => void
}) {
  const router = useRouter()
  const orderId = preview?.id ?? null
  // Keyed by the order it belongs to and derived during render, so switching
  // rows never shows the previous order's items under the new order's heading.
  const [loaded, setLoaded] = useState<{ id: string; detail: OrderDetail | null } | null>(null)
  const detail = loaded && loaded.id === orderId ? loaded.detail : null
  const loading = Boolean(orderId) && (!loaded || loaded.id !== orderId)
  const [state, transition, pending] = useActionState(adminTransitionAction, initial)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastOk = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!orderId) return
    let live = true
    fetchOrderDetail(orderId).then((d) => {
      if (live) setLoaded({ id: orderId, detail: d })
    })
    return () => { live = false }
  }, [orderId])

  // A completed transition changes both the panel and the row behind it.
  useEffect(() => {
    if (state.ok && state.ok !== lastOk.current && orderId) {
      lastOk.current = state.ok
      router.refresh()
      fetchOrderDetail(orderId).then((d) => setLoaded({ id: orderId, detail: d }))
    }
  }, [state.ok, orderId, router])

  // Escape closes; focus moves in on open and back to the row on close.
  useEffect(() => {
    if (!orderId) return
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      opener?.focus?.()
    }
  }, [orderId, onClose])

  if (!preview || !orderId) return null

  const status = detail?.status ?? preview.status
  const outlet = detail?.outlet
    ? `${detail.outlet.name} · ${detail.outlet.stationCode}`
    : preview.outletName ?? 'No outlet'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/25" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${preview.externalOrderId}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-canvas shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold text-ink">{preview.externalOrderId}</span>
              <StatusBadge status={status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">{outlet}</p>
          </div>
          <IconButton aria-label="Close" size="sm" onClick={onClose}>
            <IconClose size={18} />
          </IconButton>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 [overscroll-behavior:contain]">
          {loading ? (
            <PanelSkeleton />
          ) : !detail ? (
            <p className="text-sm text-muted">This order could not be loaded. It may have been deleted.</p>
          ) : (
            <>
              <Section title="Journey">
                <Row label="Train" value={
                  detail.trainNo
                    ? `${detail.trainNo}${detail.trainName ? ` ${detail.trainName}` : ''}`
                    : 'Not specified'
                } mono />
                <Row label="Station" value={detail.outlet?.stationCode ?? null} mono />
                <Row label="Scheduled" value={formatTimeIST(detail.scheduledArrival)} />
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">Expected</span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {formatTimeIST(detail.expectedArrival)}
                    </span>
                    {detail.timingSource === 'LIVE' && !detail.stale ? (
                      <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">LIVE</span>
                    ) : null}
                    {detail.delayMinutes !== null && detail.delayMinutes > 5 ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                        {detail.delayMinutes >= 60
                          ? `${Math.floor(detail.delayMinutes / 60)}h ${detail.delayMinutes % 60}m late`
                          : `${detail.delayMinutes}m late`}
                      </span>
                    ) : null}
                    {detail.platform ? (
                      <span className="rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">PF {detail.platform}</span>
                    ) : null}
                    {detail.trainNo ? (
                      <RefreshTrainButton orderId={detail.id} action={forceRefreshOrderTrain} />
                    ) : null}
                  </span>
                </div>
                {detail.arrived ? (
                  <p className="text-xs text-faint" title="This train has left the station, so live tracking has stopped.">
                    Train arrived · tracking stopped
                  </p>
                ) : null}
                <Row
                  label={detail.handoverPoint ? 'Handover' : 'Seat'}
                  value={detail.handoverPoint ?? detail.seat ?? null}
                  mono={!detail.handoverPoint}
                />
                {detail.pax ? <Row label="Pax" value={String(detail.pax)} /> : null}
              </Section>

              <Section title="Items">
                <ul className="divide-y divide-line">
                  {detail.items.map((i) => (
                    <li key={i.id} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0 text-sm text-ink">
                        {i.isPacking ? <span className="text-muted">packing · </span> : null}
                        {i.name}
                        <span className="ml-1.5 tabular-nums text-muted">×{i.qty}</span>
                        {i.spec ? (
                          <span className="mt-1 block whitespace-pre-wrap text-xs text-muted">{i.spec}</span>
                        ) : null}
                      </span>
                      {i.pricePaise != null ? (
                        <span className="shrink-0 text-sm tabular-nums text-muted">{formatMoney(i.pricePaise)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                  <PaymentBadge mode={detail.paymentMode} />
                  <span className="text-base font-semibold tabular-nums text-ink">{formatMoney(detail.amountPaise)}</span>
                </div>
              </Section>

              {detail.contactName || detail.contactPhone ? (
                <Section title="Passenger">
                  <div className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{detail.contactName ?? <Dash />}</p>
                      {detail.contactPhone ? (
                        <p className="font-mono text-xs tabular-nums text-muted">{detail.contactPhone}</p>
                      ) : null}
                    </div>
                    {detail.contactPhone ? (
                      <ButtonLink href={`tel:${detail.contactPhone}`} size="sm">
                        <IconPhone size={14} />
                        Call
                      </ButtonLink>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {detail.notes ? (
                <Section title="Note">
                  <p className="whitespace-pre-wrap py-1 text-sm text-muted">{detail.notes}</p>
                </Section>
              ) : null}

              {detail.nextStatuses.length > 0 ? (
                <div className="space-y-2">
                  {detail.nextStatuses.map((n) => (
                    <form key={n.to} action={transition}>
                      <input type="hidden" name="orderId" value={detail.id} />
                      <input type="hidden" name="to" value={n.to} />
                      <Button type="submit" size="lg" variant={n.danger ? 'danger' : 'primary'} pending={pending} className="w-full">
                        {n.label}
                      </Button>
                    </form>
                  ))}
                  <FormNote state={state} />
                </div>
              ) : (
                <p className="text-sm text-muted">
                  {statusLabel(detail.status)}. Nothing further for an admin to do here.
                </p>
              )}

              <Section title="Event log">
                <ol className="space-y-2.5">
                  {[...detail.events].reverse().map((e) => (
                    <li key={e.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong" />
                      <span className="min-w-0 flex-1">
                        <span className="text-ink">
                          {e.fromStatus === e.toStatus && e.action
                            ? e.action.toLowerCase().replace(/_/g, ' ')
                            : statusLabel(e.toStatus)}
                        </span>
                        <span className="block text-xs text-muted">{formatIST(e.at)} · {e.actor}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>

              <ButtonLink href={`/admin/orders/${detail.id}`} className="w-full">
                Open the full order page
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function PanelSkeleton() {
  const bar = 'rounded bg-sunken motion-safe:animate-pulse'
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">Loading order</span>
      {[5, 3, 2].map((rows, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-4">
          <div className={`${bar} mb-3 h-3 w-16`} />
          <div className="space-y-2.5">
            {Array.from({ length: rows }).map((_, j) => (
              <div key={j} className="flex justify-between gap-4">
                <div className={`${bar} h-3 w-20`} />
                <div className={`${bar} h-3 w-32`} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className={`${bar} h-12 w-full`} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className={`text-right text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value ?? <Dash />}</span>
    </div>
  )
}
