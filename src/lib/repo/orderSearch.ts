import { Restaurant, User } from '@/lib/models'
import { ORDER_SOURCES, sourceLabel } from '@/lib/orderEnums'

/** Escapes regex metacharacters so a typed term is matched literally. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Lower-cased with spaces dropped, so "yatri restro" finds YATRIRESTRO. */
function squash(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

/**
 * The fields on the order itself that the search box reads. Everything a
 * caller is likely to have in hand: the id an aggregator sent, the passenger,
 * their phone, the train, the seat, the station, and the free text staff
 * wrote on it.
 */
export const ORDER_SEARCH_FIELDS = [
  'externalOrderId',
  'contactName',
  'contactPhone',
  'trainNo',
  'trainName',
  'coach',
  'berth',
  'rawSeat',
  'stationCode',
  'handoverPoint',
  'remark',
  'notes',
  'kotNote',
  'items.name',
] as const

/**
 * The `$or` clause for one free-text search across an order, or null for a
 * blank term.
 *
 * Besides the order's own fields, a term also matches by name what the order
 * only holds an id or a code for: the aggregator (its label, so "Yatri
 * Restro" works as well as YATRIRESTRO), the outlet, and the rider. Those are
 * looked up first and turned into `$in` lists, so the result is still one
 * plain filter the caller can count and page exactly as it lists.
 */
export async function orderSearchClause(raw: string): Promise<Record<string, unknown> | null> {
  // Aggregator subjects write ids as "#6004807"; stored ids carry no '#'.
  const term = raw.trim().replace(/^#\s*/, '')
  if (!term) return null

  const rx = { $regex: escapeRegExp(term), $options: 'i' }
  const or: Record<string, unknown>[] = ORDER_SEARCH_FIELDS.map((f) => ({ [f]: rx }))

  const needle = squash(term)
  const sources = ORDER_SOURCES.filter(
    (s) => squash(s).includes(needle) || squash(sourceLabel(s)).includes(needle),
  )
  if (sources.length) or.push({ source: { $in: sources } })

  const [outlets, riders] = await Promise.all([
    Restaurant.find({ name: rx }).select('_id').lean(),
    User.find({ role: 'DELIVERY_AGENT', name: rx }).select('_id').lean(),
  ])
  if (outlets.length) or.push({ restaurantId: { $in: outlets.map((o) => o._id) } })
  if (riders.length) or.push({ 'delivery.agentIds': { $in: riders.map((r) => r._id) } })

  return { $or: or }
}

/**
 * Station codes from a query value: repeated params, or one comma-separated
 * value, upper-cased and de-duplicated.
 */
export function parseStations(values: string[]): string[] {
  const codes = values
    .flatMap((v) => v.split(','))
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
  return [...new Set(codes)]
}
