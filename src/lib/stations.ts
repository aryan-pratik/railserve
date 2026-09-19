/**
 * Station codes are the join key between orders, outlets, run keys and the
 * Station collection (which uses the code as its `_id` — see models/Station).
 *
 * Mongoose applies a schema's `uppercase` setter when saving a document, but
 * not reliably when the same field is used as a *query filter* on `_id`. A
 * lowercase code reaching a lookup would miss its station and, worse, an
 * upsert would create a second, printer-less one. So every code is normalised
 * here before it is used to find or create a Station.
 */
export function normaliseStationCode(code: string): string {
  return code.trim().toUpperCase()
}
