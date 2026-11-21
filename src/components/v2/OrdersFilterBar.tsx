import { Search } from 'lucide-react'
import { QueryForm } from '@/components/QueryForm'
import { ORDER_TYPES, ORDER_TYPE_LABEL, PAYMENT_MODES } from '@/lib/orderEnums'
import { NO_RIDER } from '@/lib/repo/riderFilter'
import { hasOrderFilters, type OrderFilterOptions, type OrderFilters } from '@/lib/repo/orderFilters'
import type { SortKey } from '@/lib/v2/orders'
import { Button, ButtonLink, cx, statusChip } from './ui'
import { ordersFieldClass } from '@/lib/v2/ordersShared'
import { OrdersDateFilter } from './OrdersDateFilter'
import { OrdersFilterMore } from './OrdersFilterMore'
import { OrdersStationSelect } from './OrdersStationSelect'
import { Select } from './Select'

/** The chip's word, capitalised, so the dropdown and the table use the same vocabulary. */
export function statusWord(status: string): string {
  const { label } = statusChip(status)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const PAYMENT_LABEL: Record<(typeof PAYMENT_MODES)[number], string> = { PREPAID: 'Prepaid', COD: 'COD', INVOICE: 'Invoice' }

/**
 * The Orders filter bar. Read with readOrderFilters and applied with
 * orderFilterClause (the same parser and clause as the v1 lookup and export),
 * plus payment and sort, which the table owns. Values other controls on the
 * page own (the view, the grouping, the returns toggle) ride as hidden inputs
 * so Apply never drops them.
 */
export function OrdersFilterBar({
  filters: f,
  options,
  payment,
  called = '',
  sort,
  showOutlet,
  showCalled = false,
  showDates,
  showSort,
  hidden,
  clearHref,
}: {
  filters: OrderFilters
  options: OrderFilterOptions
  payment: string
  /** '' | 'yes' | 'no': whether the passenger has a call note. Telecaller only. */
  called?: string
  sort: SortKey
  showOutlet: boolean
  showCalled?: boolean
  showDates: boolean
  showSort: boolean
  hidden: Record<string, string>
  clearHref: string
}) {
  const filtered = hasOrderFilters(f) || Boolean(payment) || Boolean(called)

  return (
    <QueryForm action="/v2/orders" className="grid gap-2.5">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_130px_auto]">
        <label className="relative block min-w-0">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" aria-hidden />
          <input
            name="q"
            type="search"
            defaultValue={f.q}
            placeholder="Search order id, passenger, phone, train, seat, aggregator, outlet or rider"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search orders"
            className={cx(ordersFieldClass, 'pl-9')}
          />
        </label>
        <input
          name="train"
          defaultValue={f.train}
          placeholder="Train no."
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-label="Train number"
          className={cx(ordersFieldClass, 'font-mono placeholder:font-v2')}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1 md:px-5">
            Apply
          </Button>
          {filtered ? (
            <ButtonLink href={clearHref} variant="ghost">
              Clear
            </ButtonLink>
          ) : null}
        </div>
      </div>

      <OrdersFilterMore active={activeCount(f, payment, called)}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
          <OrdersStationSelect name="station" options={options.stations} defaultSelected={f.stations} />
          {showOutlet ? (
            <Select
              name="outlet"
              defaultValue={f.outlet}
              aria-label="Outlet"
              options={[{ value: '', label: 'All outlets' }, ...options.outlets.map((o) => ({ value: o.id, label: `${o.name} · ${o.stationCode}` }))]}
            />
          ) : null}
          <Select name="status" defaultValue={f.status} aria-label="Status" options={[{ value: '', label: 'Any status' }, ...options.statuses.map((s) => ({ value: s, label: statusWord(s) }))]} />
          <Select name="type" defaultValue={f.type} aria-label="Order type" options={[{ value: '', label: 'Any type' }, ...ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABEL[t] }))]} />
          <Select
            name="rider"
            defaultValue={f.rider}
            aria-label="Rider"
            options={[
              { value: '', label: 'Any rider' },
              { value: NO_RIDER, label: 'No rider yet' },
              ...options.riders.map((r) => ({ value: r.id, label: `${r.name}${r.active ? '' : ' (inactive)'}` })),
            ]}
          />
          <Select name="payment" defaultValue={payment} aria-label="Payment" options={[{ value: '', label: 'Any payment' }, ...PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_LABEL[m] }))]} />
          {showCalled ? (
            <Select
              name="called"
              defaultValue={called}
              aria-label="Call state"
              options={[
                { value: '', label: 'Everyone' },
                { value: 'no', label: 'Not called' },
                { value: 'yes', label: 'Called' },
              ]}
            />
          ) : null}
          {showSort ? (
            <Select
              name="sort"
              defaultValue={sort}
              aria-label="Sort"
              options={[
                { value: 'eta', label: 'Arriving soonest' },
                { value: 'newest', label: 'Newest first' },
              ]}
            />
          ) : null}
        </div>

        {showDates ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-v2-muted">Dates</span>
            {/* Keyed so it shows the range the list was read with, and only
                carried once picked, so a search typed on the default view is
                not pinned to it. */}
            <OrdersDateFilter
              key={`${f.mode}|${f.month}|${f.from}|${f.to}`}
              mode={f.mode}
              month={f.month}
              from={f.from}
              to={f.to}
              allowAll
              carryUnchanged={f.modeSet}
            />
          </div>
        ) : null}
      </OrdersFilterMore>
    </QueryForm>
  )
}

/** How many of the folded controls narrow the list, for the phone toggle's badge. */
function activeCount(f: OrderFilters, payment: string, called: string): number {
  return [f.stations.length > 0, f.outlet, f.status, f.type, f.rider, payment, called, f.mode !== f.defaultMode].filter(Boolean).length
}
