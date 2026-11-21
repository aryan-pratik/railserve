import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, Phone } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { loadOrderWorkspace, type OrderWorkspace } from '@/lib/v2/orderWorkspace'
import { allowedNextStatuses, canFlagRatingOrder, canRequestCancellation, isTerminal, missingQuoteFields, type OrderStatus } from '@/lib/orderStatus'
import { formatIST, formatRupees, formatServiceDate, formatTimeIST, paiseToRupees, utcToIstLocal } from '@/lib/format'
import { rtoReasonLabel } from '@/lib/rto'
import { normalisePhone } from '@/lib/whatsapp/phone'
import { getProofStore } from '@/lib/storage'
import { ORDER_EDIT_FIELDS } from '@/lib/orderEditFields'
import { runAnchor } from '@/lib/v2/kitchenView'
import { ButtonLink, Card, Chip, Eyebrow, Mono, Seat, cx, statusChip } from '@/components/v2/ui'
import { KeyValue, Notice, PillTabs } from '@/components/v2/Table'
import { Countdown } from '@/components/v2/Countdown'
import { OrderTimeline } from '@/components/v2/OrderTimeline'
import { KitchenActions, KotNoteForm, OrderItems, RemarkForm } from '@/components/v2/OrderKitchen'
import { HandToRider, MarkReturnedButton, RefreshTrainButton, RidersChecklist } from '@/components/v2/OrderDelivery'
import { CallLog, DecideCancelRequest, OpenChatButton, OutcomeButtons } from '@/components/v2/OrderCalls'
import { DeleteOrderButton, EditOrderDetails, PaymentModeForm, StatusOverride } from '@/components/v2/OrderAdmin'
import { ConfirmEnquiryForm, MarkLostButton, QuoteForm } from '@/components/v2/OrderQuote'

type Role = 'ADMIN' | 'STORE_MANAGER' | 'TELECALLER'
type Tab = 'quote' | 'kitchen' | 'delivery' | 'calls' | 'money' | 'history'

const TAB_LABEL: Record<Tab, string> = { quote: 'Quote', kitchen: 'Kitchen', delivery: 'Delivery', calls: 'Calls', money: 'Money', history: 'History' }

function tabsFor(role: Role, enquiry: boolean): Tab[] {
  const kitchen: Tab = enquiry ? 'quote' : 'kitchen'
  if (role === 'ADMIN') return [kitchen, 'delivery', 'calls', 'money', 'history']
  if (role === 'STORE_MANAGER') return [kitchen, 'delivery', 'history']
  return ['calls', 'delivery', 'history']
}

export async function generateMetadata(props: PageProps<'/v2/orders/[id]'>) {
  const { id } = await props.params
  return { title: `Order ${id.slice(-6)} · RailServe` }
}

/**
 * One order, for everyone who works on it. The header and the right rail are
 * the same for every role; the tabs show each role its own part of the job,
 * and every button posts to the action that role already had in v1.
 */
export default async function V2OrderWorkspace(props: PageProps<'/v2/orders/[id]'>) {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER', 'TELECALLER')
  const role = ctx.role as Role
  const { id } = await props.params
  const sp = await props.searchParams

  const o = await loadOrderWorkspace(ctx, id)
  if (!o) notFound()

  const serverNowMs = new Date().getTime()
  const status = o.status as OrderStatus
  const enquiry = status === 'ENQUIRY' || status === 'QUOTED'
  const tabs = tabsFor(role, enquiry)
  const asked = typeof sp.tab === 'string' ? (sp.tab as Tab) : null
  const tab: Tab = asked && tabs.includes(asked) ? asked : tabs[0]
  const showMoney = role !== 'TELECALLER'
  const isLocal = o.orderType === 'LOCAL'
  const terminal = isTerminal(status)
  const chip = statusChip(o.status)
  const passenger = o.contactName ?? (o.orderType === 'BULK' ? 'Group order' : 'Passenger')
  const canChat = (role === 'ADMIN' || role === 'TELECALLER') && Boolean(normalisePhone(o.contactPhone))

  // Delivery proof photo: a short-lived signed URL per render, never stored.
  let photoUrl: string | null = null
  if (o.delivery.proofType === 'PHOTO' && o.delivery.proofValue) {
    try {
      photoUrl = await getProofStore().presignDownload(o.delivery.proofValue)
    } catch {
      photoUrl = null
    }
  }

  const href = (t: Tab) => `/v2/orders/${o.id}?tab=${t}`

  return (
    <div className="grid gap-[18px]">
      <Link href="/v2/orders" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-v2-muted hover:text-v2-ink">
        <ArrowLeft size={14} aria-hidden />
        Orders
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>
            {o.sourceLabel} · received {formatIST(o.createdAtIso)} · {formatServiceDate(o.serviceDate)}
          </Eyebrow>
          <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.03em]">
            <Mono>{o.externalOrderId}</Mono>
            <span className="text-v2-muted"> · </span>
            {passenger}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-v2-ink-2">
            {isLocal ? (
              <span>Local · {o.handoverPoint ?? 'no handover point'}</span>
            ) : (
              <>
                <span>
                  <Mono className="text-[15px] font-semibold text-v2-ink">{o.trainNo ?? 'No train'}</Mono>
                  {o.trainName ? <span className="text-v2-muted"> {o.trainName}</span> : null}
                </span>
                <span className="text-v2-muted">·</span>
              </>
            )}
            <span>
              {o.stationCode}
              {o.outlet ? <span className="text-v2-muted"> · {o.outlet.name}</span> : <span className="text-v2-warn"> · no outlet</span>}
            </span>
            {o.orderType === 'RETAIL' ? (
              <>
                <span className="text-v2-muted">·</span>
                <Seat coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
              </>
            ) : o.pax ? (
              <>
                <span className="text-v2-muted">·</span>
                <span>{o.pax} pax</span>
              </>
            ) : null}
            <span className="text-v2-muted">·</span>
            <span className="inline-flex items-center gap-1.5">
              {isLocal ? 'Ready by' : 'ETA'} <Mono className="font-semibold text-v2-ink">{formatTimeIST(o.etaIso)}</Mono>
              {o.bookedIso ? <s className="font-mono text-xs text-v2-faint">{formatTimeIST(o.bookedIso)}</s> : null}
              {!terminal ? <Countdown targetIso={o.etaIso} arrived={o.timing.arrived} serverNowMs={serverNowMs} size="sm" /> : null}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={chip.tone} className="h-8 px-3 text-[13px]">
            {chip.label}
          </Chip>
          {showMoney ? (
            <Chip tone={o.paymentMode === 'COD' ? 'cod' : 'grey'} className="h-8 px-3 text-[13px]">
              {o.paymentMode === 'COD' ? 'COD' : o.paymentMode ? o.paymentMode.charAt(0) + o.paymentMode.slice(1).toLowerCase() : 'Payment not set'}
              {o.amountPaise !== null ? <Mono> {formatRupees(o.amountPaise)}</Mono> : null}
            </Chip>
          ) : o.paymentMode ? (
            <Chip tone={o.paymentMode === 'COD' ? 'cod' : 'grey'} className="h-8 px-3 text-[13px]">
              {o.paymentMode === 'COD' ? 'COD' : o.paymentMode.charAt(0) + o.paymentMode.slice(1).toLowerCase()}
            </Chip>
          ) : null}
          {role === 'ADMIN' ? <EditOrderDetails orderId={o.id} values={o.editValues} outlets={o.outlets} /> : null}
          {!enquiry && role !== 'TELECALLER' ? (
            <ButtonLink href={`/v2/kitchen#${runAnchor(o.runKey)}`} size="sm">
              Open in kitchen
              <ArrowUpRight size={14} aria-hidden />
            </ButtonLink>
          ) : null}
        </div>
      </div>

      {o.cancelRequest?.status === 'PENDING' ? (
        <Notice tone="warn">
          The kitchen asked to cancel this order: &ldquo;{o.cancelRequest.reason}&rdquo; ({o.cancelRequest.requestedBy}, {formatIST(o.cancelRequest.requestedAt)}).{' '}
          {role === 'STORE_MANAGER' ? (
            'Waiting for the call desk or an admin.'
          ) : tab === 'calls' ? (
            'Decide below.'
          ) : (
            <Link href={href('calls')} className="font-bold underline underline-offset-2">
              Decide on the Calls tab
            </Link>
          )}
        </Notice>
      ) : null}
      {o.rto?.status === 'PENDING' ? (
        <Notice tone="warn">
          {rtoReasonLabel(o.rto.reason)} · the bag is coming back with {o.rto.riders.join(', ') || 'the rider'}.{' '}
          {tab === 'delivery' ? (
            'Mark it returned below once it is on the counter.'
          ) : (
            <Link href={href('delivery')} className="font-bold underline underline-offset-2">
              Delivery tab
            </Link>
          )}
        </Notice>
      ) : null}

      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-3.5">
          <PillTabs tabs={tabs.map((t) => ({ href: href(t), label: TAB_LABEL[t], active: t === tab }))} />

          {tab === 'quote' ? <QuoteTab o={o} /> : null}
          {tab === 'kitchen' ? <KitchenTab o={o} role={role} showMoney={showMoney} /> : null}
          {tab === 'delivery' ? <DeliveryTab o={o} role={role} showMoney={showMoney} photoUrl={photoUrl} serverNowMs={serverNowMs} /> : null}
          {tab === 'calls' ? <CallsTab o={o} role={role} canChat={canChat} /> : null}
          {tab === 'money' ? <MoneyTab o={o} /> : null}
          {tab === 'history' ? <HistoryTab o={o} role={role} /> : null}
        </div>

        {/* Right rail: on a phone it follows the tabs. */}
        <aside className="grid min-w-0 content-start gap-3.5">
          <Card title="Passenger">
            <div className="grid gap-1.5 text-sm">
              <b className="text-[15px]">{passenger}</b>
              {o.contactPhone ? (
                <a href={`tel:${o.contactPhone}`} className="inline-flex w-fit items-center gap-2 rounded-full bg-v2-brand-soft px-3 py-1.5 font-mono text-[15px] font-semibold tabular-nums text-v2-brand">
                  <Phone size={15} aria-hidden />
                  {o.contactPhone}
                </a>
              ) : (
                <span className="text-v2-muted">No phone number came in with this order.</span>
              )}
              <KeyValue
                className="mt-2"
                rows={[
                  ...(o.orderType === 'RETAIL' ? [{ label: 'Seat', value: <Seat coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} /> }] : []),
                  ...(o.handoverPoint && o.orderType !== 'RETAIL' ? [{ label: 'Handover', value: o.handoverPoint }] : []),
                  ...(o.pax ? [{ label: 'Pax', value: String(o.pax) }] : []),
                  { label: 'Outlet', value: o.outlet ? `${o.outlet.name} · ${o.outlet.stationCode}` : 'Not assigned' },
                  { label: 'Type', value: o.orderType.charAt(0) + o.orderType.slice(1).toLowerCase() },
                ]}
              />
              {canChat ? (
                <div className="mt-1">
                  <OpenChatButton orderId={o.id} />
                </div>
              ) : null}
            </div>
          </Card>
          <Card title="Journey" action={tab !== 'history' ? <Link href={href('history')} className="text-xs font-semibold text-v2-brand">All</Link> : null}>
            <OrderTimeline entries={o.journey} compact />
          </Card>
        </aside>
      </div>
    </div>
  )
}

/* ── tabs ──────────────────────────────────────────────────────────────── */

function NotesCard({ o }: { o: OrderWorkspace }) {
  if (!o.notes) return null
  return (
    <Card title="Notes from the order">
      <p className="whitespace-pre-wrap text-sm text-v2-ink-2">{o.notes}</p>
    </Card>
  )
}

function KitchenTab({ o, role, showMoney }: { o: OrderWorkspace; role: Role; showMoney: boolean }) {
  const status = o.status as OrderStatus
  const canRequestCancel = canRequestCancellation(role, status) && o.cancelRequest?.status !== 'PENDING'
  const adminCanCancel = allowedNextStatuses(status, 'ADMIN').includes('CANCELLED')
  const canWriteKotNote = role === 'ADMIN' || role === 'TELECALLER'
  return (
    <div className="grid gap-3.5 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Items" action={role === 'ADMIN' ? <Link href="/v2/menu" className="text-xs font-semibold text-v2-brand">Veg / non-veg tags</Link> : null}>
        <OrderItems orderId={o.id} items={o.items} canEdit={role === 'ADMIN'} showMoney={showMoney} />
        {showMoney ? (
          <div className="flex items-center justify-between border-t border-v2-line pt-3 text-sm">
            <span className="text-v2-muted">{o.paymentMode === 'COD' ? 'Cash on delivery' : o.paymentMode ? o.paymentMode.charAt(0) + o.paymentMode.slice(1).toLowerCase() : 'Payment not set'}</span>
            <Mono className="text-base font-bold">{formatRupees(o.amountPaise)}</Mono>
          </div>
        ) : null}
      </Card>
      <div className="grid min-w-0 content-start gap-3.5">
        <Card title="Next step">
          <KitchenActions
            orderId={o.id}
            externalOrderId={o.externalOrderId}
            status={o.status}
            role={role}
            hasOutlet={Boolean(o.outlet)}
            canRequestCancel={canRequestCancel}
            adminCanCancel={adminCanCancel}
          />
        </Card>
        <Card title="KOT note">
          {canWriteKotNote ? (
            <KotNoteForm orderId={o.id} kotNote={o.kotNote} />
          ) : o.kotNote ? (
            <p className="whitespace-pre-wrap rounded-v2-md bg-v2-info-bg px-3 py-2 text-sm font-medium text-v2-info">{o.kotNote}</p>
          ) : (
            <p className="text-sm text-v2-muted">No note for the ticket. The call desk or an admin writes one.</p>
          )}
        </Card>
        <Card title="Remark for the kitchen">
          {role === 'ADMIN' ? (
            <RemarkForm orderId={o.id} remark={o.remark} />
          ) : o.remark ? (
            <p className="whitespace-pre-wrap rounded-v2-md bg-v2-warn-bg px-3 py-2 text-sm font-medium text-v2-warn">{o.remark}</p>
          ) : (
            <p className="text-sm text-v2-muted">No remark from the admin.</p>
          )}
        </Card>
      </div>
      {o.notes ? (
        <div className="lg:col-span-2">
          <NotesCard o={o} />
        </div>
      ) : null}
      {role === 'STORE_MANAGER' ? (
        <Card title="Call log" className="lg:col-span-2">
          <CallLog orderId={o.id} notes={o.callNotes} canWrite={false} />
        </Card>
      ) : null}
    </div>
  )
}

function DeliveryTab({ o, role, showMoney, photoUrl, serverNowMs }: { o: OrderWorkspace; role: Role; showMoney: boolean; photoUrl: string | null; serverNowMs: number }) {
  const terminal = isTerminal(o.status as OrderStatus)
  const d = o.delivery
  const riderNames = d.agentIds.map((id) => o.riderName.get(id) ?? 'Unknown rider')
  const t = o.timing
  const hasRecord = d.dispatchedAtIso || d.deliveredAtIso || d.failureReason || d.proofValue
  const kitchen = role === 'ADMIN' || role === 'STORE_MANAGER'
  const timingRows = [
    { label: 'Expected', value: <Mono>{formatTimeIST(o.etaIso)}</Mono> },
    ...(o.bookedIso ? [{ label: 'Booked', value: <Mono className="text-v2-faint line-through">{formatTimeIST(o.bookedIso)}</Mono> }] : []),
    { label: 'Platform', value: t.platform ? `PF ${t.platform}` : 'Not known yet' },
    {
      label: 'Delay',
      value: t.delayMinutes === null ? 'No live reading' : t.delayMinutes <= 5 ? 'On time' : `${t.delayMinutes} min late`,
    },
    {
      label: 'Timing',
      value: t.source === 'LIVE' ? `Live${t.stale && t.ageMinutes !== null ? `, as of ${t.ageMinutes} min ago` : ''}` : 'Scheduled only',
    },
    ...(t.checkedAt
      ? [
          {
            label: 'Checked',
            value: t.arrived ? 'Arrived, tracking stopped' : `${formatTimeIST(t.checkedAt)} · next ${t.nextCheckAt && t.nextCheckAt.getTime() > serverNowMs ? formatTimeIST(t.nextCheckAt) : 'due now'}`,
          },
        ]
      : []),
  ]
  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <Card title={o.orderType === 'LOCAL' ? 'Ready by' : 'Leave by'} action={!terminal ? <Countdown targetIso={o.etaIso} arrived={t.arrived} serverNowMs={serverNowMs} /> : null}>
        <div>
          <div className="font-mono text-[34px] font-bold leading-none tracking-[-0.02em]">{formatTimeIST(o.orderType === 'LOCAL' ? o.readyByIso : o.leaveByIso)}</div>
          <p className="mt-1.5 text-xs text-v2-muted">
            {o.orderType === 'LOCAL'
              ? o.handoverPoint ?? 'No handover point'
              : o.leaveByIso
                ? `${o.outlet?.walkMinutes ?? 10} min walk to the platform plus buffer, from the expected arrival.`
                : 'No arrival time to work back from.'}
          </p>
        </div>
        {o.orderType === 'LOCAL' ? null : <KeyValue rows={timingRows} />}
        {kitchen && o.trainNo ? <RefreshTrainButton orderId={o.id} /> : null}
      </Card>

      <Card title="Riders">
        {terminal && role !== 'ADMIN' ? (
          <p className="text-sm text-v2-muted">{riderNames.length ? `Carried by ${riderNames.join(', ')}.` : 'No rider was recorded on this order.'}</p>
        ) : (
          <RidersChecklist orderId={o.id} riders={o.riders} assigned={d.agentIds} admin={role === 'ADMIN'} open={!terminal} pickedUpBy={d.pickedUpBy} />
        )}
      </Card>

      {kitchen && o.status === 'PREPARED' ? (
        <Card title="Hand to rider">
          <HandToRider orderId={o.id} runKey={o.runKey} riders={o.riders} assigned={d.agentIds} />
        </Card>
      ) : null}

      {o.rto ? (
        <Card title={o.rto.status === 'PENDING' ? 'Coming back to the outlet' : 'Returned to the outlet'}>
          <div className={cx('rounded-v2-md px-3 py-2.5 text-sm', o.rto.status === 'PENDING' ? 'bg-v2-warn-bg text-v2-warn' : 'bg-v2-ok-bg text-v2-ok')}>
            <p className="font-semibold">
              {rtoReasonLabel(o.rto.reason)} · {o.rto.status === 'PENDING' ? `${o.rto.riders.join(', ') || 'the rider'} has the bag` : `brought back by ${o.rto.riders.join(', ') || 'the rider'}`}
            </p>
            <p className="mt-0.5 text-xs opacity-80">
              {o.rto.status === 'PENDING' ? `Out since ${formatIST(o.rto.openedAt)}.` : `Taken back by ${o.rto.returnedBy ?? 'unknown'} · ${formatIST(o.rto.returnedAt)}`}
            </p>
            {o.rto.note ? <p className="mt-0.5 text-xs">&ldquo;{o.rto.note}&rdquo;</p> : null}
          </div>
          {o.rto.status === 'PENDING' ? (
            o.canCollectReturns ? (
              <MarkReturnedButton orderId={o.id} externalOrderId={o.externalOrderId} />
            ) : (
              <p className="text-sm text-v2-muted">Waiting for the outlet to take the bag back.</p>
            )
          ) : null}
        </Card>
      ) : null}

      <Card title="Delivery record" className={hasRecord ? 'lg:col-span-2' : undefined}>
        {!hasRecord ? (
          <p className="text-sm text-v2-muted">Nothing recorded yet. Times, cash and the handover photo appear here once the bag leaves the counter.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <KeyValue
              rows={[
                ...(riderNames.length ? [{ label: 'Carried by', value: riderNames.join(', ') }] : []),
                ...(d.dispatchedAtIso ? [{ label: 'Left the kitchen', value: formatIST(d.dispatchedAtIso) }] : []),
                ...(d.deliveredAtIso ? [{ label: 'Handed over', value: formatIST(d.deliveredAtIso) }] : []),
                ...(d.proofType === 'SIGNATURE' && d.proofValue ? [{ label: 'Received by', value: d.proofValue }] : []),
                ...(d.proofType === 'OTP' && d.proofValue ? [{ label: 'OTP', value: <Mono>{d.proofValue}</Mono> }] : []),
                ...(showMoney && d.amountCollectedPaise != null ? [{ label: 'Cash collected', value: <Mono>{formatRupees(d.amountCollectedPaise)}</Mono> }] : []),
                ...(d.failureReason ? [{ label: 'Not delivered', value: <span className="font-semibold text-v2-bad">{d.failureReason}</span> }] : []),
              ]}
            />
            {photoUrl ? (
              <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL on an external bucket, expires */}
                <img src={photoUrl} alt="Photo taken at handover" className="max-h-64 w-full rounded-v2-md border border-v2-line bg-v2-sunken object-contain" />
              </a>
            ) : d.proofType === 'PHOTO' && d.proofValue ? (
              <Notice>A photo is on file but cannot be shown right now. Proof storage is unavailable.</Notice>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  )
}

function CallsTab({ o, role, canChat }: { o: OrderWorkspace; role: Role; canChat: boolean }) {
  const status = o.status as OrderStatus
  const next = role === 'TELECALLER' ? allowedNextStatuses(status, 'TELECALLER') : []
  const can = {
    cancel: next.includes('CANCELLED'),
    deliver: next.includes('DELIVERED'),
    fail: next.includes('FAILED'),
    misdeliver: next.includes('MISDELIVERY'),
    missDeliver: next.includes('MISSED_DELIVERY'),
    refund: next.includes('REFUNDED'),
    rating: role === 'TELECALLER' && canFlagRatingOrder('TELECALLER') && status !== 'RATING_ORDER',
  }
  const canWrite = role === 'ADMIN' || role === 'TELECALLER'
  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <Card title="Passenger contact">
        <div className="grid gap-2 text-sm">
          <b className="text-[15px]">{o.contactName ?? 'Passenger'}</b>
          {o.contactPhone ? (
            <div className="flex flex-wrap items-center gap-2">
              <a href={`tel:${o.contactPhone}`} className="inline-flex items-center gap-2 rounded-full bg-v2-brand-soft px-3.5 py-2 font-mono text-base font-semibold tabular-nums text-v2-brand">
                <Phone size={16} aria-hidden />
                {o.contactPhone}
              </a>
              {canChat ? <OpenChatButton orderId={o.id} /> : null}
            </div>
          ) : (
            <Notice tone="warn">No phone number came in with this order, so there is nobody to ring from here.</Notice>
          )}
          {o.remark ? (
            <div className="mt-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-v2-faint">Remark from admin</span>
              <p className="mt-1 whitespace-pre-wrap rounded-v2-md bg-v2-warn-bg px-3 py-2 text-sm font-medium text-v2-warn">{o.remark}</p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="Outcome of the call">
        {role === 'TELECALLER' ? (
          <OutcomeButtons orderId={o.id} externalOrderId={o.externalOrderId} status={o.status} can={can} />
        ) : (
          <p className="text-sm text-v2-muted">
            Delivered, not delivered, misdelivery, missed delivery, refund and rating-order are recorded by the call desk from the passenger&apos;s own words. An admin cancels from the Kitchen tab or sets a status directly under History.
          </p>
        )}
      </Card>

      {o.cancelRequest ? (
        <Card title={o.cancelRequest.status === 'PENDING' ? 'Cancellation requested' : o.cancelRequest.status === 'APPROVED' ? 'Cancellation request accepted' : 'Cancellation request refused'}>
          <div className={cx('rounded-v2-md px-3 py-2.5 text-sm', o.cancelRequest.status === 'PENDING' ? 'bg-v2-warn-bg text-v2-warn' : o.cancelRequest.status === 'APPROVED' ? 'bg-v2-bad-bg text-v2-bad' : 'bg-v2-surface-2 text-v2-ink-2')}>
            <p className="whitespace-pre-wrap font-semibold">&ldquo;{o.cancelRequest.reason}&rdquo;</p>
            <p className="mt-0.5 text-xs opacity-80">
              {o.cancelRequest.requestedBy} · {formatIST(o.cancelRequest.requestedAt)}
            </p>
          </div>
          {o.cancelRequest.status !== 'PENDING' && o.cancelRequest.decidedBy ? (
            <p className="text-sm text-v2-muted">
              {o.cancelRequest.status === 'APPROVED' ? 'Accepted' : 'Refused'} by {o.cancelRequest.decidedBy}
              {o.cancelRequest.decidedAt ? ` · ${formatIST(o.cancelRequest.decidedAt)}` : ''}
              {o.cancelRequest.decisionNote ? <>: &ldquo;{o.cancelRequest.decisionNote}&rdquo;</> : null}
            </p>
          ) : null}
          {o.cancelRequest.status === 'PENDING' && canWrite ? <DecideCancelRequest orderId={o.id} externalOrderId={o.externalOrderId} /> : null}
        </Card>
      ) : null}

      <Card title="Call log" className={o.cancelRequest ? undefined : 'lg:col-span-2'}>
        <CallLog orderId={o.id} notes={o.callNotes} canWrite={canWrite} />
      </Card>

      {role === 'TELECALLER' ? (
        <Card title="KOT note" className="lg:col-span-2">
          <KotNoteForm orderId={o.id} kotNote={o.kotNote} />
        </Card>
      ) : null}
      <NotesCard o={o} />
    </div>
  )
}

function MoneyTab({ o }: { o: OrderWorkspace }) {
  const d = o.delivery
  const itemsTotal = o.items.reduce((sum, i) => sum + (i.pricePaise ?? 0) * i.qty, 0)
  const priced = o.items.some((i) => i.pricePaise !== null)
  const settled = Boolean(d.codSettledAtIso)
  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <Card title="Amount">
        <div className="font-mono text-[34px] font-bold leading-none tracking-[-0.02em]">{formatRupees(o.amountPaise)}</div>
        <KeyValue
          rows={[
            { label: 'Items', value: priced ? <Mono>{formatRupees(itemsTotal)}</Mono> : 'Not priced per item' },
            { label: 'Mode', value: o.paymentMode === 'COD' ? 'Cash on delivery' : o.paymentMode ? o.paymentMode.charAt(0) + o.paymentMode.slice(1).toLowerCase() : 'Not set' },
            { label: 'Source', value: o.sourceLabel },
          ]}
        />
        <div className="border-t border-v2-line pt-3">
          <PaymentModeForm orderId={o.id} paymentMode={o.paymentMode} />
        </div>
      </Card>
      <Card title="Cash on delivery">
        {o.paymentMode !== 'COD' ? (
          <p className="text-sm text-v2-muted">Not a cash order.</p>
        ) : (
          <KeyValue
            rows={[
              { label: 'Collected', value: d.amountCollectedPaise != null ? <Mono>{formatRupees(d.amountCollectedPaise)}</Mono> : o.status === 'DELIVERED' ? 'Not recorded' : 'Not yet delivered' },
              { label: 'Settled', value: settled ? `${formatIST(d.codSettledAtIso)} · ${d.codSettledBy ?? 'unknown'}` : d.amountCollectedPaise != null ? 'With the rider' : 'Nothing to settle yet' },
              ...(d.collectedBy ? [{ label: 'Handed to', value: d.collectedBy }] : []),
            ]}
          />
        )}
      </Card>
      <Card title="Linked payment">
        <p className="text-sm text-v2-muted">Not linked. Bank credits in Payments are matched by aggregator and date, not yet to single orders.</p>
        <ButtonLink href="/v2/payments" size="sm" className="w-fit">
          Open payments
        </ButtonLink>
      </Card>
    </div>
  )
}

function HistoryTab({ o, role }: { o: OrderWorkspace; role: Role }) {
  return (
    <div className="grid gap-3.5 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Journey" className={role === 'ADMIN' ? 'lg:row-span-3' : 'lg:row-span-2'}>
        <OrderTimeline entries={o.journey} />
      </Card>
      {o.cancelRequest ? (
        <Card title="Cancellation request">
          <KeyValue
            rows={[
              { label: 'Status', value: o.cancelRequest.status.charAt(0) + o.cancelRequest.status.slice(1).toLowerCase() },
              { label: 'Asked by', value: `${o.cancelRequest.requestedBy} · ${formatIST(o.cancelRequest.requestedAt)}` },
              { label: 'Reason', value: o.cancelRequest.reason },
              ...(o.cancelRequest.decidedBy ? [{ label: 'Answered by', value: `${o.cancelRequest.decidedBy} · ${formatIST(o.cancelRequest.decidedAt)}` }] : []),
              ...(o.cancelRequest.decisionNote ? [{ label: 'Note', value: o.cancelRequest.decisionNote }] : []),
            ]}
          />
        </Card>
      ) : null}
      <Card title="Provenance">
        <KeyValue
          rows={[
            { label: 'Source', value: `${o.sourceLabel} (${o.source})` },
            { label: 'Created', value: formatIST(o.createdAtIso) },
            { label: 'Updated', value: formatIST(o.updatedAtIso) },
            { label: 'Service date', value: formatServiceDate(o.serviceDate) },
          ]}
        />
        {o.pastedText ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-v2-ink-2">Original message</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-v2-md bg-v2-sunken p-3 font-mono text-xs text-v2-ink-2">{o.pastedText}</pre>
          </details>
        ) : null}
      </Card>
      {role === 'ADMIN' ? (
        <Card title="Admin controls">
          <StatusOverride orderId={o.id} status={o.status} />
          <div className="grid gap-2 border-t border-v2-line pt-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-v2-bad">Danger zone</span>
            <DeleteOrderButton orderId={o.id} externalOrderId={o.externalOrderId} />
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function QuoteTab({ o }: { o: OrderWorkspace }) {
  const menu = o.items.find((i) => !i.isPacking)?.spec ?? null
  const packed = o.items.filter((i) => i.isPacking).map((i) => i.name)
  const missing = missingQuoteFields({
    restaurantId: o.outlet?.id ?? null,
    contactPhone: o.contactPhone,
    amountPaise: o.amountPaise,
    paymentMode: o.paymentMode,
    readyBy: o.readyByIso,
  }).map((f) => ORDER_EDIT_FIELDS.find((e) => e.key === f)?.label.toLowerCase() ?? f)
  return (
    <div className="grid gap-3.5 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Quote" className="lg:row-span-2">
        <QuoteForm
          orderId={o.id}
          outlets={o.outlets}
          values={{
            restaurantId: o.outlet?.id ?? '',
            amountRupees: paiseToRupees(o.amountPaise),
            paymentMode: o.paymentMode ?? '',
            readyBy: utcToIstLocal(o.readyByIso),
            contactName: o.contactName ?? '',
            contactPhone: o.contactPhone ?? '',
            handoverPoint: o.handoverPoint ?? '',
          }}
        />
      </Card>
      <Card title="Menu as requested">
        {menu ? <pre className="whitespace-pre-wrap font-v2 text-sm text-v2-ink-2">{menu}</pre> : <p className="text-sm text-v2-muted">No menu text on this enquiry.</p>}
        {o.items.filter((i) => !i.isPacking).length > 0 ? (
          <div className="border-t border-v2-line pt-3">
            <OrderItems orderId={o.id} items={o.items} canEdit showMoney />
          </div>
        ) : null}
      </Card>
      <Card title={o.status === 'QUOTED' ? 'Confirm' : 'Not quoted yet'}>
        {o.status === 'QUOTED' ? (
          <ConfirmEnquiryForm orderId={o.id} alreadyPacked={packed} missing={missing} />
        ) : (
          <p className="text-sm text-v2-muted">Save the quote first. Confirming is offered once the enquiry is quoted.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-v2-line pt-3">
          <MarkLostButton orderId={o.id} externalOrderId={o.externalOrderId} />
        </div>
      </Card>
      <NotesCard o={o} />
    </div>
  )
}
