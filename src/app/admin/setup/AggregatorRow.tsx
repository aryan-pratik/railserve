'use client'

import { useActionState, useState } from 'react'
import { Button, FormNote, focusRing, inputBase } from '@/components/ui'
import { setListingOutlet, type ListingState } from './listingActions'

const initial: ListingState = {}

/**
 * One aggregator storefront, and the kitchen it routes to.
 *
 * The whole row is the control: pick a kitchen, press Save. It only appears
 * once the choice has actually changed, so a screen of twelve storefronts
 * doesn't show twelve identical buttons competing for attention.
 *
 * "Move past orders too" is deliberately off by default and deliberately
 * present. Re-pointing a storefront has two meanings — correcting a mistake,
 * or moving a brand from next week — and they want opposite things to happen
 * to the orders already in the books. Defaulting to "don't touch history" is
 * the one that can't quietly rewrite last month's accounts.
 */
export function AggregatorRow({
  listing,
  outlets,
  stationDefaultName,
}: {
  listing: {
    id: string
    name: string
    source: string | null
    stationCode: string
    restaurantId: string | null
    orderCount: number
  }
  /** Only the kitchens at this listing's own station — you cannot cook Kanpur food in Gaya. */
  outlets: { id: string; name: string }[]
  stationDefaultName: string | null
}) {
  const [state, action, pending] = useActionState(setListingOutlet, initial)
  const [choice, setChoice] = useState(listing.restaurantId ?? '')
  const changed = choice !== (listing.restaurantId ?? '')

  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <div className="font-medium text-ink [overflow-wrap:anywhere]">{listing.name}</div>
        <div className="mt-0.5 text-xs text-muted">
          {listing.source ? (
            <span className="font-mono">{listing.source}</span>
          ) : (
            <span className="italic">aggregator unknown</span>
          )}
          <span className="mx-1.5" aria-hidden>·</span>
          <span className="font-mono">{listing.stationCode}</span>
        </div>
      </td>

      <td className="hidden px-3 py-2.5 tabular-nums text-muted sm:table-cell">
        {listing.orderCount > 0 ? listing.orderCount : <span className="text-faint">—</span>}
      </td>

      <td className="px-3 py-2">
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="listingId" value={listing.id} />
          <label className="sr-only" htmlFor={`outlet-${listing.id}`}>
            Kitchen for {listing.name}
          </label>
          <select
            id={`outlet-${listing.id}`}
            name="restaurantId"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className={`${inputBase} h-9 min-w-[12rem] text-sm`}
          >
            <option value="">
              {stationDefaultName
                ? `Station default — ${stationDefaultName}`
                : 'Station default — none set'}
            </option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          {changed ? (
            <>
              {/* Offered only when the storefront has an aggregator recorded.
                  Without one, its orders are indistinguishable from the rest of
                  the outlet's, so there is nothing safe to move. */}
              {listing.source ? (
                <label
                  className={`inline-flex items-center gap-1.5 rounded px-1 text-xs text-muted ${focusRing}`}
                >
                  <input type="checkbox" name="moveExisting" className="size-3.5" />
                  Move {listing.orderCount > 0 ? `${listing.orderCount} past order(s)` : 'past orders'} too
                </label>
              ) : null}
              <Button type="submit" size="sm" pending={pending}>
                Save
              </Button>
            </>
          ) : null}
          <FormNote state={state} />
        </form>
      </td>
    </tr>
  )
}
