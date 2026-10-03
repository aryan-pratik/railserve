/**
 * Which mail senders the Gmail sync turns into orders.
 *
 * The mailbox receives far more than aggregator orders — newsletters, Google
 * notices, replies — and every one of those that reached the parsers became a
 * "could not parse" row in the inbox, burying the real failures. An admin
 * lists the aggregators' sending addresses under Setup → Aggregators, and
 * from then on mail from anyone else is skipped without a row. An empty list
 * means "parse everything", which is how it behaved before the list existed,
 * so turning this on is a choice and never a surprise.
 *
 * Pure, and free of Mongoose, so the setup screen and the tests share it.
 */

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const DOMAIN = /^@[^\s@<>]+\.[^\s@<>]+$/

/**
 * Normalises one entry an admin typed: a full address (`orders@zoop.in`) or a
 * whole domain written with its `@` (`@zoop.in`). Returns null for anything
 * else, so a typo is refused at the form rather than matching nothing later.
 */
export function normaliseSenderEntry(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (!v) return null
  // A pasted "Zoop <orders@zoop.in>" is accepted as its address.
  const bracketed = /<([^>]+)>/.exec(v)
  const value = bracketed ? bracketed[1].trim() : v
  return ADDRESS.test(value) || DOMAIN.test(value) ? value : null
}

/** The bare address out of a From header: `"Zoop" <orders@zoop.in>` → `orders@zoop.in`. */
export function senderAddress(from: string | null | undefined): string | null {
  if (!from) return null
  const bracketed = /<([^>]+)>/.exec(from)
  const value = (bracketed ? bracketed[1] : from).trim().toLowerCase()
  return ADDRESS.test(value) ? value : null
}

/**
 * Whether mail from this sender should be parsed as an order. True for any
 * sender while the list is empty. A From header with no readable address is
 * refused once a list exists — it cannot be shown to be on it.
 */
export function isAllowedSender(from: string | null | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true
  const address = senderAddress(from)
  if (!address) return false
  const domain = address.slice(address.indexOf('@'))
  return allowed.some((entry) => entry === address || entry === domain)
}
