import { connectDb } from '../db'
import { ownsOutlet, type AuthContext } from '../authContext'
import { PARSERS } from './index'
import { createOrderFromParsed } from './index'
import { matchOutlet } from './outletMatch'

/**
 * Creates an order from text pasted into the console.
 *
 * The interactive counterpart to ingestEmail. Same parsers, same outlet
 * matching, same document — but a different answer to failure: an emailed order
 * that will not parse is filed in the unparsed inbox for someone to find later,
 * whereas a pasted one is failing in front of the person who pasted it. Telling
 * them what is wrong is strictly better than silently filing it, and filing it
 * anyway would fill the inbox with drafts nobody meant to submit.
 */
export type PasteResult =
  | { ok: true; orderId: string; externalOrderId: string; outletName: string }
  | { ok: false; detail: string }

export async function createOrderFromPaste(
  ctx: AuthContext,
  body: string,
): Promise<PasteResult> {
  if (ctx.role !== 'ADMIN' && ctx.role !== 'STORE_MANAGER') {
    return { ok: false, detail: 'You may not create orders.' }
  }

  const text = body.trim()
  if (!text) return { ok: false, detail: 'Paste the order text first.' }

  await connectDb()

  const parser = PARSERS.find((p) => p.matches(text))
  if (!parser) {
    return {
      ok: false,
      detail: 'This does not look like an order from a recognised aggregator. Use the form below instead.',
    }
  }

  const result = parser.parse(text, new Date())
  if (!result.ok) {
    return { ok: false, detail: result.detail }
  }

  const parsed = result.order

  // Never fuzzy-match an outlet into a live order (§6, §13.11) — routing food
  // to the wrong kitchen is worse than refusing to route it at all.
  const outlet = await matchOutlet(parsed.outletName, parsed.stationCode)
  if (!outlet.ok) {
    return { ok: false, detail: outlet.detail }
  }

  // Checked here rather than inside createOrderFromParsed, which ingestion also
  // calls with no user attached. A manager may only paste into their own kitchen.
  if (!ownsOutlet(ctx, outlet.restaurantId)) {
    return { ok: false, detail: `${outlet.name} is not one of your outlets.` }
  }

  const outcome = await createOrderFromParsed(
    parsed,
    outlet.restaurantId,
    { pastedText: text, pastedAt: new Date(), pastedById: String(ctx.userId) },
    null,
  )

  if (outcome.status === 'DUPLICATE') {
    return { ok: false, detail: `Order ${outcome.externalOrderId} is already in the system.` }
  }
  if (outcome.status !== 'CREATED') {
    return { ok: false, detail: outcome.detail }
  }

  return {
    ok: true,
    orderId: outcome.orderId,
    externalOrderId: outcome.externalOrderId,
    outletName: outlet.name,
  }
}
