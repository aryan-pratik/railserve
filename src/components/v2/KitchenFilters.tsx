'use client'

import Link from 'next/link'
import { QueryForm } from '@/components/QueryForm'
import { Select } from './Select'
import { cx, v2Focus } from './ui'

const SELECT = 'h-9 max-w-[16rem] border-v2-line-strong text-[13px] font-semibold'

/**
 * The admin's narrowing: one station, or one outlet. Store managers never
 * see it; their scope is their outlets. Selects apply on change, and the
 * rest of the board's URL state rides along as hidden fields.
 */
export function KitchenFilters({
  stations,
  outlets,
  current,
  carry,
  clearHref,
}: {
  stations: { code: string; label: string }[]
  outlets: { id: string; name: string; stationCode: string }[]
  current: { station: string | null; outlet: string | null }
  /** Params to keep: day, status, wall. */
  carry: Record<string, string>
  clearHref: string
}) {
  const outletChoices = current.station ? outlets.filter((o) => o.stationCode === current.station) : outlets
  return (
    <QueryForm action="/v2/kitchen" className="flex flex-wrap items-center gap-2" aria-label="Narrow the board">
      {Object.entries(carry).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Select
        id="kitchen-station"
        name="station"
        aria-label="Station"
        size="sm"
        defaultValue={current.station ?? ''}
        submitOnChange
        className="w-auto max-sm:w-full"
        buttonClassName={SELECT}
        options={[{ value: '', label: 'All stations' }, ...stations.map((s) => ({ value: s.code, label: s.label }))]}
      />
      <Select
        id="kitchen-outlet"
        name="outlet"
        aria-label="Outlet"
        size="sm"
        defaultValue={current.outlet ?? ''}
        submitOnChange
        className="w-auto max-sm:w-full"
        buttonClassName={SELECT}
        options={[{ value: '', label: 'All outlets' }, ...outletChoices.map((o) => ({ value: o.id, label: `${o.name} · ${o.stationCode}` }))]}
      />
      {current.station || current.outlet ? (
        <Link href={clearHref} className={cx('rounded-full px-2 text-[13px] font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
          Clear
        </Link>
      ) : null}
    </QueryForm>
  )
}
