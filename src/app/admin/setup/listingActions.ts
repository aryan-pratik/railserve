'use server'

import { revalidatePath } from 'next/cache'
import mongoose from 'mongoose'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Listing, Restaurant, Station } from '@/lib/models'
import { repointOrdersBetweenOutlets } from '@/lib/repo/orderRepo'
import { normaliseStationCode } from '@/lib/stations'
import type { OrderSource } from '@/lib/orderEnums'

/**
 * Actions behind Setup → Aggregators: which of our kitchens cooks for each
 * storefront name an aggregator puts in its mail.
 *
 * Admin-only, and every one of these is ordinary configuration rather than a
 * data fix — the whole point of the screen is that nobody should need a script
 * to re-point a storefront again.
 */

export type ListingState = { error?: string; ok?: string }

/**
 * Point a storefront at a different kitchen.
 *
 * Optionally moves the orders already filed under it. Two genuinely different
 * intentions: "this was mapped wrongly, fix the history too", and "from
 * Monday this brand moves to the other kitchen, leave the books alone". The
 * caller has to say which, because guessing rewrites accounts either way.
 */
export async function setListingOutlet(
  _prev: ListingState,
  formData: FormData,
): Promise<ListingState> {
  const ctx = await requireRole('ADMIN')

  const listingId = String(formData.get('listingId') ?? '')
  const restaurantId = String(formData.get('restaurantId') ?? '')
  const moveExisting = String(formData.get('moveExisting') ?? '') === 'on'

  if (!mongoose.isValidObjectId(listingId)) return { error: 'Unknown listing' }

  await connectDb()
  const listing = await Listing.findById(listingId)
  if (!listing) return { error: 'Unknown listing' }

  // Empty means "unmapped": the station default takes over again, which is a
  // legitimate thing to want rather than an error.
  if (!restaurantId) {
    listing.restaurantId = null
    await listing.save()
    // Orders already filed stay where they are: unmapping changes where the
    // NEXT mail goes, and silently moving finished work would rewrite books
    // nobody asked to rewrite.
    revalidatePath('/admin/setup')
    return { ok: `${listing.name} now follows the station default.` }
  }

  if (!mongoose.isValidObjectId(restaurantId)) return { error: 'Unknown outlet' }
  const outlet = await Restaurant.findById(restaurantId).select('name stationCode active').lean()
  if (!outlet) return { error: 'Unknown outlet' }

  // A storefront at Kanpur cannot be cooked at Gaya. Refusing here is the same
  // stance matchOutlet takes on a name/station disagreement.
  if (normaliseStationCode(outlet.stationCode) !== normaliseStationCode(listing.stationCode)) {
    return { error: `${outlet.name} is at ${outlet.stationCode}, but this listing is at ${listing.stationCode}.` }
  }
  if (outlet.active === false) return { error: `${outlet.name} is deactivated.` }

  const previous = listing.restaurantId
  listing.restaurantId = outlet._id
  await listing.save()

  let moved = 0
  if (moveExisting && previous && String(previous) !== String(outlet._id)) {
    // Without an aggregator on the listing there is no way to tell which of
    // the old outlet's orders arrived through THIS storefront, so the honest
    // answer is that they cannot be moved — not "move all of them".
    if (!listing.source) {
      return {
        error:
          `Re-pointed ${listing.name}, but its past orders were left where they are: ` +
          'this storefront has no aggregator recorded, so there is no way to tell its orders ' +
          "apart from the outlet's others.",
      }
    }
    moved = await repointOrdersBetweenOutlets(ctx, {
      from: previous,
      to: outlet._id,
      source: listing.source as OrderSource,
    })
  }

  revalidatePath('/admin/setup')
  revalidatePath('/admin')
  return {
    ok: `${listing.name} now goes to ${outlet.name}${moved > 0 ? `, and ${moved} past order(s) moved with it` : ''}.`,
  }
}

/** Retire a storefront an aggregator has stopped using. */
export async function toggleListingActive(formData: FormData) {
  await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'
  if (!mongoose.isValidObjectId(id)) return

  await connectDb()
  await Listing.updateOne({ _id: id }, { $set: { active } })
  revalidatePath('/admin/setup')
}

/**
 * Set the kitchen a station falls back to for a storefront nobody has mapped.
 *
 * Without one, an unrecognised name at a known station goes to the unparsed
 * inbox instead of to a stove — so this is what keeps a new aggregator from
 * silently stalling orders on its first day.
 */
export async function setStationDefault(formData: FormData) {
  await requireRole('ADMIN')
  const stationCode = normaliseStationCode(String(formData.get('stationCode') ?? ''))
  const restaurantId = String(formData.get('restaurantId') ?? '')
  if (!stationCode) return

  await connectDb()
  if (!restaurantId) {
    await Station.updateOne({ _id: stationCode }, { $set: { defaultRestaurantId: null } })
    revalidatePath('/admin/setup')
    return
  }
  if (!mongoose.isValidObjectId(restaurantId)) return

  const outlet = await Restaurant.findById(restaurantId).select('stationCode').lean()
  if (!outlet || normaliseStationCode(outlet.stationCode) !== stationCode) return

  await Station.updateOne(
    { _id: stationCode },
    { $set: { defaultRestaurantId: outlet._id }, $setOnInsert: { active: true } },
    { upsert: true },
  )
  revalidatePath('/admin/setup')
}
