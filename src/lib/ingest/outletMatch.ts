import { Restaurant } from '../models'

/**
 * Resolves an aggregator's outlet name to a restaurant.
 *
 * Plan §6, and it is the strongest instruction in the document: "If the outlet
 * doesn't match a restaurant name or one of its aliases, do not guess — write
 * to unparsedinbox with reason UNKNOWN_OUTLET. Routing to the wrong kitchen is
 * worse than a delay."
 *
 * So this does exact matching only, case- and whitespace-insensitive. No
 * fuzzy distance, no partial containment, no "closest match". An ambiguous
 * result — two outlets claiming the same alias — is also a refusal, because
 * picking one of them is precisely the guess this must not make.
 */
export type OutletMatch =
  | { ok: true; restaurantId: string; name: string; stationCode: string }
  | { ok: false; detail: string }

function normalise(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ')
}

export async function matchOutlet(
  outletName: string,
  stationCode: string,
): Promise<OutletMatch> {
  const wanted = normalise(outletName)

  // Active outlets only: an order routed to a closed kitchen is a lost order.
  const candidates = await Restaurant.find({ active: true })
    .select('name aliases stationCode')
    .lean()

  const hits = candidates.filter(
    (r) =>
      normalise(r.name) === wanted ||
      (r.aliases ?? []).some((a) => normalise(a) === wanted),
  )

  if (hits.length === 0) {
    return { ok: false, detail: `no active outlet named ${JSON.stringify(outletName)}` }
  }

  if (hits.length > 1) {
    // Narrow by station before giving up — the same brand at two stations is
    // a legitimate reason for a shared alias.
    const atStation = hits.filter(
      (r) => r.stationCode.toUpperCase() === stationCode.toUpperCase(),
    )
    if (atStation.length === 1) {
      const r = atStation[0]
      return { ok: true, restaurantId: String(r._id), name: r.name, stationCode: r.stationCode }
    }
    return {
      ok: false,
      detail:
        `${hits.length} outlets match ${JSON.stringify(outletName)} ` +
        `(${hits.map((h) => `${h.name}/${h.stationCode}`).join(', ')}) — refusing to guess`,
    }
  }

  const r = hits[0]

  // A name match at the wrong station is still suspicious enough to stop for.
  if (r.stationCode.toUpperCase() !== stationCode.toUpperCase()) {
    return {
      ok: false,
      detail:
        `outlet ${r.name} is registered at ${r.stationCode} but the order says ` +
        `${stationCode} — refusing to guess`,
    }
  }

  return { ok: true, restaurantId: String(r._id), name: r.name, stationCode: r.stationCode }
}
