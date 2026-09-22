'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ButtonLink, Dash, FormNote, PaymentBadge, StatusBadge, statusLabel } from '@/components/ui'
import { IconChevronDown, IconPhone } from '@/components/Icons'
import { formatIST, formatMoney, formatTimeIST } from '@/lib/format'
import { adminTransitionAction, forceRefreshOrderTrain, type ActionState } from './orders/[id]/actions'
import { fetchOrderDetail, type OrderDetail } from './orderDetail'
import { RefreshTrainButton } from '@/components/RefreshTrainButton'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CallLog } from '@/components/CallLog'
import { CallNoteForm } from '@/components/CallNoteForm'
import type { CallNoteView } from '@/lib/callNotes'

const initial: ActionState = {}

function lateLabel(mins: number): string {
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m late` : `${mins}m late`
}

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
  // Which danger action (e.g. "CANCELLED") is waiting on a yes/no before it
  // submits. A single click used to fire the transition immediately, which is
  // how a mis-tap cancelled a live, paid order with no undo.
  const [confirming, setConfirming] = useState<string | null>(null)

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
      setConfirming(null)
      router.refresh()
      fetchOrderDetail(orderId).then((d) => setLoaded({ id: orderId, detail: d }))
    }
  }, [state.ok, orderId, router])

  if (!preview || !orderId) return null

  const status = detail?.status ?? preview.status
  const outlet = detail?.outlet
    ? `${detail.outlet.name} · ${detail.outlet.stationCode}`
    : preview.outletName ?? 'No outlet'

  const primaryOptions = detail?.nextStatuses.filter((n) => !n.danger) ?? []
  const dangerOptions = detail?.nextStatuses.filter((n) => n.danger) ?? []

  // Pinned below the scrollable body rather than inside it, so the primary
  // action is never lost behind a long note or a big item list. Danger on
  // the left, the routine move on the right: two clearly separate targets
  // instead of one full-width slab stacked over a second one.
  const footer = detail ? (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        {dangerOptions.map((n) => (
          <Button
            key={n.to}
            type="button"
            variant="danger"
            className="flex-1"
            onClick={() => setConfirming(n.to)}
          >
            {n.label}
          </Button>
        ))}
        {primaryOptions.map((n) => (
          <form key={n.to} action={transition} className="flex-1">
            <input type="hidden" name="orderId" value={detail.id} />
            <input type="hidden" name="to" value={n.to} />
            <Button type="submit" variant="primary" pending={pending} className="w-full">
              {n.label}
            </Button>
          </form>
        ))}
        {primaryOptions.length === 0 && dangerOptions.length === 0 ? (
          <p className="flex-1 self-center text-center text-sm text-muted">
            {statusLabel(detail.status)}. Nothing further for an admin to do here.
          </p>
        ) : null}
      </div>
      {/* Sits under the whole row rather than beside just one side, so it
          reads as the outcome of either button, not just the one on the right. */}
      <FormNote state={state} />
    </div>
  ) : null

  const confirmingOption = detail?.nextStatuses.find((n) => n.to === confirming) ?? null

  return (
    <>
    <Modal
      titleId="admin-order-modal"
      onClose={onClose}
      maxWidthClassName="max-w-xl"
      maxHeightClassName="max-h-[85vh]"
      footer={footer}
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
              {/* The overview a decision actually needs, in one line, before
                  four sections of raw facts the admin would otherwise have to
                  assemble by hand to answer "is this order fine to accept". */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-sunken px-3 py-2 text-sm">
                <span className="font-semibold text-ink">
                  {detail.pax
                    ? `${detail.pax} pax`
                    : `${detail.items.filter((i) => !i.isPacking).length} item${
                        detail.items.filter((i) => !i.isPacking).length === 1 ? '' : 's'
                      }`}
                </span>
                <span className="font-semibold tabular-nums text-ink">{formatMoney(detail.amountPaise)}</span>
                <PaymentBadge mode={detail.paymentMode} />
                {detail.platform ? (
                  <span className="rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">PF {detail.platform}</span>
                ) : null}
                {detail.delayMinutes !== null ? (
                  detail.delayMinutes > 5 ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                      {lateLabel(detail.delayMinutes)}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-emerald-700">on time</span>
                  )
                ) : null}
              </div>

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
                        {lateLabel(detail.delayMinutes)}
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

              {/* Call log and the full event history are the right thing to
                  have, but not before the accept decision — closed by
                  default on a fresh order so they add no scroll weight,
                  open by default once there is already something recorded
                  worth seeing at a glance. */}
              <details open={detail.callLog.length > 0} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between border-t border-line py-3 first:border-0 [&::-webkit-details-marker]:hidden">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    History
                  </span>
                  <IconChevronDown size={14} className="text-faint transition-transform group-open:rotate-180" aria-hidden />
                </summary>

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
              </details>

              <ButtonLink href={`/admin/orders/${detail.id}`} className="w-full">
                Open the full order page
              </ButtonLink>
            </>
          )}
      </div>
    </Modal>

    {confirmingOption && detail ? (
      <ConfirmDialog
        titleId="admin-order-modal-confirm"
        title={`${confirmingOption.label} this order?`}
        onCancel={() => setConfirming(null)}
        actions={
          <>
            <form action={transition}>
              <input type="hidden" name="orderId" value={detail.id} />
              <input type="hidden" name="to" value={confirmingOption.to} />
              <Button type="submit" variant="danger" pending={pending}>
                {confirmingOption.label}
              </Button>
            </form>
            <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
          </>
        }
      >
        This cannot be undone from here. The kitchen is told immediately once you confirm.
      </ConfirmDialog>
    ) : null}
    </>
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
