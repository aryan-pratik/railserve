import mongoose from 'mongoose'
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

/** At most this many words are read from one search, each costing two lookups. */
const MAX_TERMS = 6

/**
 * A typed phone number reduced to the digits orders store, or null when the
 * search is not a phone number. Parsers keep the last ten digits, so
 * "+91 98765-43210" and "098765 43210" both become 9876543210.
 */
export function phoneDigits(raw: string): string | null {
  if (!/^\+?[\d\s()\-.]+$/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  // 10 digits, or 10 behind a 0 / 91 / +91 prefix. Ten digits split only by
  // spaces are left as words: "98765 43210" finds the phone word by word
  // anyway, and "12301 12302" stays two trains.
  if (digits.length < 10 || digits.length > 13) return null
  if (digits.length === 10 && /\s/.test(raw)) return null
  return digits.slice(-10)
}

/**
 * The words a search is matched by. A phone number typed with spaces stays one
 * word; everything else splits on spaces and commas, and each word loses the
 * leading '#' aggregator subjects put on ids ("#6004807").
 */
export function searchTerms(raw: string): string[] {
  const trimmed = raw.trim()
  const phone = phoneDigits(trimmed)
  if (phone) return [phone]
  const words = trimmed
    .split(/[\s,]+/)
    .map((w) => w.replace(/^#+/, ''))
    .filter(Boolean)
  return [...new Set(words)].slice(0, MAX_TERMS)
}

/** Coach and berth from a seat typed as "B4-23", "b4/23" or "B4:23". */
function seatParts(term: string): { coach: string; berth: string } | null {
  const m = /^([a-z]+\d*)[-/:.]+(\d+)$/i.exec(term)
  return m ? { coach: m[1], berth: m[2] } : null
}

/** Everything one search word can match on an order, as `$or` alternatives. */
async function termAlternatives(term: string): Promise<Record<string, unknown>[]> {
  const rx = { $regex: escapeRegExp(term), $options: 'i' }
  const or: Record<string, unknown>[] = ORDER_SEARCH_FIELDS.map((f) => ({ [f]: rx }))

  // The order's own id, as in its /admin/orders/<id> link.
  if (mongoose.isValidObjectId(term) && /^[0-9a-f]{24}$/i.test(term)) {
    or.push({ _id: new mongoose.Types.ObjectId(term) })
  }

  // Coach and berth are stored apart, and rawSeat joins them however the
  // aggregator did, so "B4/23" has to match "B4-23" and "B4 23" as well.
  const seat = seatParts(term)
  if (seat) {
    const exact = (v: string) => ({ $regex: `^${escapeRegExp(v)}$`, $options: 'i' })
    or.push({ coach: exact(seat.coach), berth: exact(seat.berth) })
    or.push({
      rawSeat: { $regex: `^${escapeRegExp(seat.coach)}\\W*${escapeRegExp(seat.berth)}$`, $options: 'i' },
    })
  }

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

  return or
}

/**
 * The filter clause for one free-text search across an order, or null for a
 * blank term.
 *
 * Every word has to match somewhere, but not in the same field: "rahul 12301"
 * is the passenger on that train, "ravi gaya" the rider's orders at that
 * station. Besides the order's own fields, a word also matches by name what
 * the order only holds an id or a code for: the aggregator (its label, so
 * "Yatri Restro" works as well as YATRIRESTRO), the outlet, and the rider.
 * Those are looked up first and turned into `$in` lists, so the result is
 * still one plain filter the caller can count and page exactly as it lists.
 */
export async function orderSearchClause(raw: string): Promise<Record<string, unknown> | null> {
  const terms = searchTerms(raw)
  if (terms.length === 0) return null
  const clauses = await Promise.all(terms.map(async (t) => ({ $or: await termAlternatives(t) })))
  return clauses.length === 1 ? clauses[0] : { $and: clauses }
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
