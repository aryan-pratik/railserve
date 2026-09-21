'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ButtonLink, Dash, FormNote, PaymentBadge, StatusBadge, focusRing, statusLabel } from '@/components/ui'
import { IconPhone } from '@/components/Icons'
import { formatIST, formatMoney, formatTimeIST } from '@/lib/format'
import { adminTransitionAction, forceRefreshOrderTrain, type ActionState } from './orders/[id]/actions'
import { fetchOrderDetail, type OrderDetail } from './orderDetail'
import { RefreshTrainButton } from '@/components/RefreshTrainButton'
import { Modal } from '@/components/Modal'
import { CallLog } from '@/components/CallLog'
import { CallNoteForm } from '@/components/CallNoteForm'
import type { CallNoteView } from '@/lib/callNotes'

const initial: ActionState = {}

/** What the board already knows about a row, painted before the fetch lands. */
export type OrderPreview = {
  id: string
  externalOrderId: string
  status: string
  outletName: string | null
}

/**
 * Order detail, in a dialog over the board.
 *
 * A dialog rather than a page because the board is the workspace: an admin
 * checks an order, acts on it, and carries on down the list. It was a
 * right-hand slide-over first, which gave a tall narrow column that forced
 * every row of the Journey and Items sections to wrap.
 *
 * Built on the shared Modal rather than its own shell, so the escape key,
 * focus handling and scroll lock behave the way every other dialog here
 * behaves. The hand-rolled copy had already drifted from it.
 *
 * The header paints from the row that was clicked, so it is never blank: the
 * id, status and outlet are on screen the same frame it opens, and the fetch
 * fills in the rest underneath a skeleton.
 *
 * After a transition the board is refreshed too, or the row's status badge
 * quietly disagrees with the dialog on top of it.
 */
export function OrderModal({
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
  const lastOk = useRef<string | undefined>(undefined)

  /**
   * Paint the log the action just handed back.
   *
   * Not a refetch: this panel holds its own copy of the order, and going back
   * for it races the revalidation the same action triggers. It lost often
   * enough that a new note only appeared after closing and reopening. The
   * action already knows the answer, so it returns it.
   */
  const applyNotes = useCallback(
    (notes: CallNoteView[]) => {
      setLoaded((prev) =>
        prev && prev.id === orderId && prev.detail
          ? { id: prev.id, detail: { ...prev.detail, callLog: notes } }
          : prev,
      )
    },
    [orderId],
  )

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

  if (!preview || !orderId) return null

  const status = detail?.status ?? preview.status
  const outlet = detail?.outlet
    ? `${detail.outlet.name} · ${detail.outlet.stationCode}`
    : preview.outletName ?? 'No outlet'

  return (
    <Modal
      titleId="admin-order-modal"
      onClose={onClose}
      maxWidthClassName="max-w-xl"
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-base font-semibold text-ink">
            {preview.externalOrderId}
          </span>
          <StatusBadge status={status} />
          <span className="w-full truncate text-xs font-normal text-muted sm:w-auto">{outlet}</span>
        </span>
      }
    >
      <div className="space-y-3 px-5 py-4">
          {loading ? (
            <DetailSkeleton />
          ) : !detail ? (
            <p className="text-sm text-muted">This order could not be loaded. It may have been deleted.</p>
          ) : (
            <>
              <Section title="Journey">
                {/* Two columns on anything but a phone: this is the tallest
                    block in the dialog and a modal has the width to halve it. */}
                <div className="grid gap-x-6 sm:grid-cols-2">
                <Row label="Train" value={
                  detail.trainNo
                    ? `${detail.trainNo}${detail.trainName ? ` ${detail.trainName}` : ''}`
                    : 'Not specified'
                } mono />
                <Row label="Station" value={detail.outlet?.stationCode ?? null} mono />
                <Row label="Scheduled" value={formatTimeIST(detail.scheduledArrival)} />
                <div className="flex items-baseline justify-between gap-3 py-1 sm:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Expected</span>
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
                  <p className="text-xs text-faint sm:col-span-2" title="This train has left the station, so live tracking has stopped.">
                    Train arrived · tracking stopped
                  </p>
                ) : null}
                <Row
                  label={detail.handoverPoint ? 'Handover' : 'Seat'}
                  value={detail.handoverPoint ?? detail.seat ?? null}
                  mono={!detail.handoverPoint}
                />
                {detail.pax ? <Row label="Pax" value={String(detail.pax)} /> : null}
                </div>
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
                        {i.notes ? (
                          <span className="mt-1 block whitespace-pre-wrap text-xs italic text-muted">{i.notes}</span>
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
                  <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(detail.amountPaise)}</span>
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
                /* The routine move is the loud one. These used to be two
                   full-width h-12 slabs, so cancelling an order shouted exactly
                   as loudly as accepting it, and a destructive action that
                   competes with the ordinary one for the eye is how it gets
                   clicked by mistake. */
                <div className="space-y-2">
                  {detail.nextStatuses
                    .filter((n) => !n.danger)
                    .map((n) => (
                      <form key={n.to} action={transition}>
                        <input type="hidden" name="orderId" value={detail.id} />
                        <input type="hidden" name="to" value={n.to} />
                        <Button type="submit" variant="primary" pending={pending} className="w-full">
                          {n.label}
                        </Button>
                      </form>
                    ))}
                  {detail.nextStatuses.some((n) => n.danger) ? (
                    <div className="flex flex-wrap justify-center gap-x-4">
                      {detail.nextStatuses
                        .filter((n) => n.danger)
                        .map((n) => (
                          <form key={n.to} action={transition}>
                            <input type="hidden" name="orderId" value={detail.id} />
                            <input type="hidden" name="to" value={n.to} />
                            <button
                              type="submit"
                              disabled={pending}
                              className={`rounded px-2 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 ${focusRing}`}
                            >
                              {n.label}
                            </button>
                          </form>
                        ))}
                    </div>
                  ) : null}
                  <FormNote state={state} />
                </div>
              ) : (
                <p className="text-sm text-muted">
                  {statusLabel(detail.status)}. Nothing further for an admin to do here.
                </p>
              )}

              <Section title="Call log">
                <div className="-mx-5">
                  <CallLog orderId={detail.id} notes={detail.callLog} onChanged={applyNotes} />
                  <div className="border-t border-line">
                    <CallNoteForm orderId={detail.id} onSaved={applyNotes} />
                  </div>
                </div>
              </Section>

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
    </Modal>
  )
}

function DetailSkeleton() {
  const bar = 'rounded bg-sunken motion-safe:animate-pulse'
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">Loading order</span>
      {[5, 3, 2].map((rows, i) => (
        <div key={i} className="border-t border-line pt-3 first:border-0 first:pt-0">
          <div className={`${bar} mb-2 h-3 w-16`} />
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
      <div className={`${bar} h-9 w-full`} />
    </div>
  )
}

/**
 * A labelled band, not a box.
 *
 * This was a card, inside a canvas strip, inside Modal's own card: three
 * container levels, about 300px of padding and borders before a single row of
 * content, and a dialog that ran past the bottom of a laptop screen. Cards are
 * the lazy container and nested cards are always wrong; grouping here is done
 * with a hairline rule and spacing instead.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3 first:border-0 first:pt-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className={`text-right text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value ?? <Dash />}</span>
    </div>
  )
}
