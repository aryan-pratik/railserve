import { Listing, Restaurant, Station } from '../models'
import type { OrderSource } from '../orderEnums'

/**
 * Resolves the outlet name in an aggregator's mail to one of our kitchens.
 *
 * Plan §6 is still the strongest instruction in the document: "If the outlet
 * doesn't match, do not guess — write to unparsedinbox. Routing to the wrong
 * kitchen is worse than a delay." What changed is what counts as a guess.
 *
 * The name in the mail is one of three things, and they are tried in this
 * order because that is the order of certainty:
 *
 *   1. One of OUR outlets, named directly. Yatri Restro's mail says "HOTEL
 *      GANGA GALAXY"; Zoop's says "THE COSMOZIN LOUNGE". Nothing to infer.
 *   2. A storefront name we have mapped — "YATRI BHOJAN", "RajBhog Khana" —
 *      which a `Listing` points at the kitchen behind it. Someone decided this
 *      once, in Setup; it is configuration, not inference.
 *   3. A storefront we have never mapped, at a station we know. It still has
 *      to be cooked somewhere, and one station is one stove, so it goes to
 *      that station's default outlet rather than to the unparsed inbox.
 *
 * Only a name that matches nothing, at a station we cannot place, is a
 * refusal. Note that (3) is not the "guess" §6 forbids: every outlet at a
 * station shares one kitchen and one printer, so the food is cooked in the
 * right place either way — the default only decides which brand's book it
 * lands in, and an admin can remap it afterwards.
 *
 * Routing is by NAME, never by aggregator. One aggregator names several
 * different outlets of ours (YatriRestro mails carry all three CNB names), so
 * keying on `source` would send most of them to the wrong kitchen.
 */
export type OutletMatch =
  | {
      ok: true
      restaurantId: string
      name: string
      stationCode: string
      /**
       * How it was resolved. Callers use it to tell a decided route from a
       * fallback; nothing persists it on the order yet, so do not treat it as
       * an audit trail.
       */
      via: 'outlet' | 'listing' | 'station-default'
      /** The storefront row this came through, when there was one. */
      listingId?: string
      /** The storefront name as the mail wrote it, when that was not our own outlet's name. */
      listingName?: string
    }
  | { ok: false; detail: string }

function normalise(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ')
}

export async function matchOutlet(
  outletName: string,
  stationCode: string | null,
  /**
   * Which aggregator sent this. Not used to route — see the note above — but
   * recorded on a storefront discovered here, so the Aggregators screen can
   * say where an unmapped name came from.
   */
  source: OrderSource | null = null,
): Promise<OutletMatch> {
  const wanted = normalise(outletName)

  // --- 1. one of our own outlets, named directly ---------------------------
  // Active only: an order routed to a closed kitchen is a lost order.
  const outlets = await Restaurant.find({ active: true })
    .select('name aliases stationCode')
    .lean()

  const hits = outlets.filter(
    (r) =>
      normalise(r.name) === wanted || (r.aliases ?? []).some((a) => normalise(a) === wanted),
  )

  if (hits.length === 1) {
    const r = hits[0]
    // A name match at the wrong station is still suspicious enough to stop
    // for. Nothing to disagree with when the mail carries no station.
    if (stationCode && r.stationCode.toUpperCase() !== stationCode.toUpperCase()) {
      return {
        ok: false,
        detail:
          `outlet ${r.name} is registered at ${r.stationCode} but the order says ` +
          `${stationCode}: refusing to guess`,
      }
    }
    return {
      ok: true,
      restaurantId: String(r._id),
      name: r.name,
      stationCode: r.stationCode,
      via: 'outlet',
    }
  }

  if (hits.length > 1) {
    // The same brand at two stations is a legitimate reason for a shared
    // name; the station breaks the tie. With no station, nothing does.
    const atStation = stationCode
      ? hits.filter((r) => r.stationCode.toUpperCase() === stationCode.toUpperCase())
      : []
    if (atStation.length === 1) {
      const r = atStation[0]
      return {
        ok: true,
        restaurantId: String(r._id),
        name: r.name,
        stationCode: r.stationCode,
        via: 'outlet',
      }
    }
    return {
      ok: false,
      detail:
        `${hits.length} outlets match ${JSON.stringify(outletName)} ` +
        `(${hits.map((h) => `${h.name}/${h.stationCode}`).join(', ')}): refusing to guess`,
    }
  }

  // --- 2. a mapped aggregator storefront -----------------------------------
  const listings = await Listing.find({ active: true })
    .select('name aliases stationCode restaurantId')
    .lean()

  let listingHits = listings.filter(
    (l) =>
      normalise(l.name) === wanted || (l.aliases ?? []).some((a) => normalise(a) === wanted),
  )
  // Same storefront name at two stations is normal — an aggregator uses one
  // brand across the network. The station picks the right one.
  if (listingHits.length > 1 && stationCode) {
    const atStation = listingHits.filter(
      (l) => l.stationCode.toUpperCase() === stationCode.toUpperCase(),
    )
    if (atStation.length === 1) listingHits = atStation
  }

  if (listingHits.length > 1) {
    return {
      ok: false,
      detail:
        `${listingHits.length} aggregator listings match ${JSON.stringify(outletName)}: refusing to guess`,
    }
  }

  const listing = listingHits[0] ?? null

  // Where to look for a default: the listing's own station if we matched one,
  // otherwise whatever station the mail carried.
  const fallbackStation = listing?.stationCode ?? stationCode
  if (listing?.restaurantId) {
    const outlet = outlets.find((r) => String(r._id) === String(listing.restaurantId))
    if (outlet) {
      return {
        ok: true,
        restaurantId: String(outlet._id),
        name: outlet.name,
        stationCode: outlet.stationCode,
        via: 'listing',
        listingId: String(listing._id),
        listingName: listing.name,
      }
    }
    // Mapped at a kitchen that has since been deactivated. Fall through to the
    // station default rather than filing against a closed outlet.
  }

  // --- 3. unmapped, but we know the station --------------------------------
  if (!fallbackStation) {
    return {
      ok: false,
      detail:
        `no outlet or aggregator listing named ${JSON.stringify(outletName)}, ` +
        'and the mail carries no station to fall back on',
    }
  }

  const station = await Station.findById(normalise(fallbackStation))
    .select('defaultRestaurantId')
    .lean()
  const fallback = station?.defaultRestaurantId
    ? outlets.find((r) => String(r._id) === String(station.defaultRestaurantId))
    : null

  if (!fallback) {
    return {
      ok: false,
      detail:
        `${JSON.stringify(outletName)} is not a known outlet or listing, and ` +
        `${fallbackStation} has no default outlet set: nothing to route it to`,
    }
  }

  // Record the storefront we have just met, unmapped.
  //
  // Without this an unrecognised name is cooked by the default kitchen and
  // then vanishes: nothing ever writes it down, so it never appears in Setup →
  // Aggregators and nobody can point it at the right stove. Writing it here is
  // what turns "it went somewhere sensible" into "and you can fix it".
  //
  // Upserted rather than created: two mails from a new aggregator can land in
  // the same second, and the second one must not add a duplicate row.
  let listingId: string | undefined = listing ? String(listing._id) : undefined
  const listingName = listing?.name ?? outletName.trim()

  if (!listing) {
    const code = normalise(fallbackStation)
    const seen = await Listing.findOneAndUpdate(
      { name: listingName, stationCode: code },
      { $setOnInsert: { name: listingName, stationCode: code, source, restaurantId: null, active: true } },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    ).lean()
    if (seen) listingId = String(seen._id)
  }

  return {
    ok: true,
    restaurantId: String(fallback._id),
    name: fallback.name,
    stationCode: fallback.stationCode,
    via: 'station-default',
    ...(listingId ? { listingId } : {}),
    listingName,
  }
}
