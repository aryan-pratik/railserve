import { IconSearch } from '@/components/Icons'
import { Button, ButtonLink, Field, inputClass, statusLabel } from '@/components/ui'
import { DateFilter } from '@/components/DateFilter'
import { StationMultiSelect } from '@/components/StationMultiSelect'
import { QueryForm } from '@/components/QueryForm'
import { ORDER_TYPES, ORDER_TYPE_LABEL } from '@/lib/orderEnums'
import { NO_RIDER } from '@/lib/repo/riderFilter'
import { hasOrderFilters, type OrderFilterOptions, type OrderFilters } from '@/lib/repo/orderFilters'

/**
 * The order filter bar: search and train number on the first row; station,
 * outlet, status, type, rider and Apply on the second; the date chips below.
 * Read with readOrderFilters and applied with orderFilterClause, so every
 * screen that shows it filters the same way.
 */
export function OrderFilterBar({
  action,
  filters: f,
  options,
  hidden = {},
}: {
  /** The page the form submits to; also where Clear lands. */
  action: string
  filters: OrderFilters
  options: OrderFilterOptions
  /** Values other controls on the page own (a tab), kept across Apply. */
  hidden?: Record<string, string>
}) {
  const clearQs = new URLSearchParams(Object.entries(hidden).filter(([, v]) => v)).toString()
  return (
    <QueryForm action={action} className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-6">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="relative sm:col-span-2 lg:col-span-5">
        <IconSearch size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input name="q" type="search" defaultValue={f.q}
          placeholder="Search orders: ID, passenger, phone, train, seat, aggregator, outlet, rider…"
          autoComplete="off" spellCheck={false}
          className={`${inputClass} pl-9`} aria-label="Search orders" />
      </div>
      <input name="train" defaultValue={f.train} placeholder="Train number" inputMode="numeric"
        autoComplete="off" spellCheck={false}
        className={`${inputClass} font-mono`} aria-label="Train number" />
      <StationMultiSelect name="station" options={options.stations} defaultSelected={f.stations} />
      <select name="outlet" defaultValue={f.outlet} className={inputClass} aria-label="Outlet">
        <option value="">All outlets</option>
        {options.outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.stationCode}
          </option>
        ))}
      </select>
      <select name="status" defaultValue={f.status} className={inputClass} aria-label="Status">
        <option value="">Any status</option>
        {options.statuses.map((s) => (
          <option key={s} value={s}>{statusLabel(s)}</option>
        ))}
      </select>
      <select name="type" defaultValue={f.type} className={inputClass} aria-label="Order type">
        <option value="">Any type</option>
        {ORDER_TYPES.map((t) => (
          <option key={t} value={t}>{ORDER_TYPE_LABEL[t]}</option>
        ))}
      </select>
      <select name="rider" defaultValue={f.rider} className={inputClass} aria-label="Rider">
        <option value="">Any rider</option>
        <option value={NO_RIDER}>No rider yet</option>
        {options.riders.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}{r.active ? '' : ' (inactive)'}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className="flex-1">Apply</Button>
        {hasOrderFilters(f) ? (
          <ButtonLink href={clearQs ? `${action}?${clearQs}` : action} variant="ghost">Clear</ButtonLink>
        ) : null}
      </div>
      <div className="sm:col-span-2 lg:col-span-6">
        <Field label="Date">
          <DateFilter mode={f.mode} month={f.month} from={f.from} to={f.to} allowAll />
        </Field>
      </div>
    </QueryForm>
  )
}
