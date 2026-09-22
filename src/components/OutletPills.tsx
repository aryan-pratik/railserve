/**
 * One pill colour per station, not per outlet. Shared between admin's Setup
 * → Staff tab and the store manager's Riders page, so the same station reads
 * as the same colour wherever staff outlets are listed.
 *
 * There are a dozen outlets and a handful of stations. Nobody can learn twelve
 * hues, and neighbouring hues blur together, whereas "is this person on CNB or
 * on Gaya" is exactly what a manager scans this column for. Emerald is left
 * out on purpose: it usually means Active in a column beside this one.
 */
export const STATION_TONES = [
  'bg-sky-50 text-sky-800 ring-sky-200',
  'bg-violet-50 text-violet-800 ring-violet-200',
  'bg-amber-50 text-amber-900 ring-amber-200',
  'bg-rose-50 text-rose-800 ring-rose-200',
  'bg-teal-50 text-teal-800 ring-teal-200',
  'bg-indigo-50 text-indigo-800 ring-indigo-200',
] as const

/**
 * One colour per station, assigned by sorted order so it is stable between
 * visits and two stations never share one until there are more stations
 * than colours.
 */
export function stationToneMap(stationCodes: Iterable<string>): Map<string, string> {
  return new Map(
    [...new Set(stationCodes)]
      .sort()
      .map((code, i) => [code, STATION_TONES[i % STATION_TONES.length]]),
  )
}

/** The station, in its colour. */
export function StationPill({
  code, name, tone,
}: {
  code: string
  name?: string | null
  tone?: string
}) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span
        className={`rounded-full px-2 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset ${tone ?? 'bg-sunken text-muted ring-line'}`}
      >
        {code}
      </span>
      {name ? <span className="text-xs text-faint [overflow-wrap:anywhere]">{name}</span> : null}
    </span>
  )
}

type OutletLite = { name: string; stationCode: string }

/** Grouped by station, then by name, so each colour sits together. */
export function OutletPills({
  ids,
  outletById,
  stationTone,
}: {
  ids: string[]
  outletById: Map<string, OutletLite>
  stationTone: Map<string, string>
}) {
  const known = ids
    .map((id) => outletById.get(id))
    .filter((o): o is OutletLite => Boolean(o))
    .sort((a, b) => a.stationCode.localeCompare(b.stationCode) || a.name.localeCompare(b.name))
  const unknown = ids.length - known.length

  return (
    <span className="flex flex-wrap gap-1">
      {known.map((o) => (
        <span
          key={`${o.stationCode}-${o.name}`}
          title={`${o.name} · ${o.stationCode}`}
          className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset [overflow-wrap:anywhere] ${stationTone.get(o.stationCode) ?? 'bg-sunken text-muted ring-line'}`}
        >
          {o.name}
          <span className="font-mono text-[10px] opacity-70">{o.stationCode}</span>
        </span>
      ))}
      {unknown > 0 ? (
        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">
          {unknown} unknown
        </span>
      ) : null}
    </span>
  )
}
