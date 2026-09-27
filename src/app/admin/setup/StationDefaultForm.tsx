'use client'

import { useState } from 'react'
import { Button, inputBase } from '@/components/ui'
import { setStationDefault } from './listingActions'

/**
 * The kitchen a station falls back to for a storefront nobody has mapped yet.
 *
 * This is the safety net that stops a new aggregator stalling on its first
 * day: their mail names a storefront we have never seen, and rather than
 * landing in the unparsed inbox it goes to this kitchen. One station is one
 * stove, so the food is cooked in the right place regardless; the default only
 * decides whose book it lands in, and the row above can re-point it afterwards.
 */
export function StationDefaultForm({
  stationCode,
  current,
  outlets,
}: {
  stationCode: string
  current: string | null
  outlets: { id: string; name: string }[]
}) {
  const [choice, setChoice] = useState(current ?? '')
  const changed = choice !== (current ?? '')

  return (
    <form action={setStationDefault} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="stationCode" value={stationCode} />
      <label htmlFor={`default-${stationCode}`} className="text-xs font-medium text-muted">
        Unmapped storefronts at <span className="font-mono text-ink">{stationCode}</span> go to
      </label>
      <select
        id={`default-${stationCode}`}
        name="restaurantId"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className={`${inputBase} h-9 min-w-[12rem] text-sm`}
      >
        <option value="">Nothing — hold them in the inbox</option>
        {outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {changed ? (
        <Button type="submit" size="sm" variant="secondary">
          Save
        </Button>
      ) : null}
    </form>
  )
}
