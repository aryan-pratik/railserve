'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, FormNote, StatusBadge, statusLabel } from '@/components/ui'
import { formatIST, formatMoney, formatTimeIST } from '@/lib/format'
import { adminTransitionAction, type ActionState } from './orders/[id]/actions'
import { fetchOrderDetail, type OrderDetail } from './orderDetail'

const initial: ActionState = {}

/**
 * Order detail, slid in from the right.
 *
 * A panel rather than a page because the board is the workspace: an admin
 * checks an order, acts on it, and carries on down the list. Navigating away
 * and back would lose their place in it every time.
 *
 * The board stays mounted underneath, so after a transition we refresh it
 * rather than re-fetching only the panel — the row's status badge has to move
 * too, or the list quietly disagrees with the panel on top of it.
 */
export function OrderSlideOver({
  orderId,
  onClose,
}: {
  orderId: string | null
  onClose: () => void
}) {
  const router = useRouter()
  // Keyed by the order it belongs to, and derived during render rather than
  // cleared in an effect. Clearing synchronously in an effect costs an extra
  // render pass, and — worse — briefly shows the previous order's details under
  // the new order's heading.
  const [loaded, setLoaded] = useState<{ id: string; detail: OrderDetail | null } | null>(null)
  const detail = loaded && loaded.id === orderId ? loaded.detail : null
  const [state, transition, pending] = useActionState(adminTransitionAction, initial)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastOk = useRef<string | undefined>(undefined)

  // Load whenever the selected order changes.
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

  // Escape closes, and focus moves in on open — a panel a keyboard user can
  // open but not leave is worse than no panel.
  useEffect(() => {
    if (!orderId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [orderId, onClose])

  if (!orderId) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Order details"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-canvas shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Order details
            </h2>
            {detail ? (
              <>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-semibold text-ink">
                    {detail.externalOrderId}
                  </span>
                  <StatusBadge status={detail.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {detail.outlet ? `${detail.outlet.name} · ${detail.outlet.stationCode}` : 'No outlet'}
                </p>
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order details"
            className="rounded-lg p-1.5 text-muted transition hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!loaded || loaded.id !== orderId ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : !detail ? (
            <p className="text-sm text-muted">This order could not be loaded.</p>
          ) : (
            <>
              <Section title="Journey">
                <Row label="Train" value={
                  detail.trainNo
                    ? `${detail.trainNo}${detail.trainName ? ` ${detail.trainName}` : ''}`
                    : 'Not specified'
                } mono />
                <Row label="Station" value={detail.outlet?.stationCode ?? '—'} mono />
                <Row label="Scheduled" value={formatTimeIST(detail.scheduledArrival)} />
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Expected
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {formatTimeIST(detail.expectedArrival)}
                    </span>
                    {detail.timingSource === 'LIVE' && !detail.stale ? (
                      <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        LIVE
                      </span>
                    ) : null}
                    {detail.delayMinutes !== null && detail.delayMinutes > 5 ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                        {detail.delayMinutes >= 60
                          ? `${Math.floor(detail.delayMinutes / 60)}h ${detail.delayMinutes % 60}m late`
                          : `${detail.delayMinutes}m late`}
                      </span>
                    ) : null}
                    {detail.platform ? (
                      <span className="rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">
                        PF {detail.platform}
                      </span>
                    ) : null}
                  </span>
                </div>
                {detail.arrived ? (
                  // A separate line rather than another badge crowding the row
                  // above — this is the reason nothing on this order's timing
                  // will move again, worth its own sentence.
                  <p
                    className="text-xs font-medium text-faint"
                    title="This train has left the station. Its arrival, delay and platform here are final, so live tracking has stopped."
                  >
                    Train arrived · tracking stopped
                  </p>
                ) : null}
                <Row
                  label={detail.handoverPoint ? 'Handover' : 'Seat'}
                  value={detail.handoverPoint ?? detail.seat ?? '—'}
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
                          <span className="mt-1 block whitespace-pre-wrap text-xs text-muted">
                            {i.spec}
                          </span>
                        ) : null}
                      </span>
                      {i.pricePaise != null ? (
                        <span className="shrink-0 text-sm tabular-nums text-muted">
                          {formatMoney(i.pricePaise)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                      detail.paymentMode === 'COD'
                        ? 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200'
                        : 'text-muted'
                    }`}
                  >
                    {detail.paymentMode ?? '—'}
                  </span>
                  <span className="text-base font-semibold tabular-nums text-ink">
                    {formatMoney(detail.amountPaise)}
                  </span>
                </div>
              </Section>

              {detail.contactName || detail.contactPhone ? (
                <Section title="Passenger">
                  <div className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {detail.contactName ?? '—'}
                      </p>
                      {detail.contactPhone ? (
                        <p className="font-mono text-xs text-muted">{detail.contactPhone}</p>
                      ) : null}
                    </div>
                    {detail.contactPhone ? (
                      <a
                        href={`tel:${detail.contactPhone}`}
                        className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-sunken"
                      >
                        Call
                      </a>
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
                      <Button
                        type="submit"
                        size="lg"
                        variant={n.danger ? 'danger' : 'primary'}
                        disabled={pending}
                        className="w-full"
                      >
                        {n.label}
                      </Button>
                    </form>
                  ))}
                  <FormNote state={state} />
                </div>
              ) : (
                <p className="text-sm text-muted">
                  {statusLabel(detail.status)} — nothing further for an admin to do here.
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
                        <span className="block text-xs text-muted">
                          {formatIST(e.at)} · {e.actor}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>

              <Link
                href={`/admin/orders/${detail.id}`}
                className="block text-center text-sm font-medium text-accent underline-offset-2 hover:underline"
              >
                Open the full order page →
              </Link>
            </>
          )}
        </div>
      </div>
    </>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className={`text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
