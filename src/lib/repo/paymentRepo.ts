import type { QueryFilter } from 'mongoose'
import { Payment, type PaymentDoc } from '../models'
import { connectDb } from '../db'
import { ForbiddenError, NotFoundError, type AuthContext } from '../authContext'

/**
 * THE ONLY PLACE Payment.find / aggregate MAY BE CALLED.
 *
 * Unlike orderRepo there is no per-outlet scope to enforce here, and that is
 * a deliberate statement rather than an oversight: the credits land in one
 * shared bank account, an alert names a payer and nothing else, and there is
 * no field that could say which outlet a payment belongs to. Inventing one by
 * guessing would be worse than showing everyone the same list.
 *
 * What IS scoped is the balance — see `latestBalance`, admin only.
 */

export type PaymentQuery = {
  /** Inclusive 'YYYY-MM-DD' bounds on transactionDate. Blank means unbounded. */
  from?: string
  to?: string
  /** Free text against the payer name or the RRN. */
  q?: string
}

/** Everything except the free-text search, which several callers apply separately. */
function buildFilter({ from, to, q }: PaymentQuery): QueryFilter<PaymentDoc> {
  const filter: QueryFilter<PaymentDoc> = {}

  if (from || to) {
    const range: Record<string, string> = {}
    if (from) range.$gte = from
    if (to) range.$lte = to
    filter.transactionDate = range
  }

  if (q) {
    // Escaped, because an RRN pasted from a chat can carry anything and a
    // stray '(' would otherwise throw rather than simply match nothing.
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { payerName: { $regex: safe, $options: 'i' } },
      { rrn: { $regex: safe, $options: 'i' } },
      { remark: { $regex: safe, $options: 'i' } },
    ]
  }

  return filter
}

export async function findPayments(query: PaymentQuery = {}, limit = 500) {
  await connectDb()
  return Payment.find(buildFilter(query))
    // Newest first, and `receivedAt` breaks the tie — several credits share a
    // transactionDate, and the alert's own date carries no time of day.
    .sort({ transactionDate: -1, receivedAt: -1 })
    .limit(limit)
    .lean()
}

export type PaymentTotals = { count: number; totalPaise: number }

/** Count and sum for the filtered range — what the summary card reports. */
export async function paymentTotals(query: PaymentQuery = {}): Promise<PaymentTotals> {
  await connectDb()
  const [row] = await Payment.aggregate<{ count: number; totalPaise: number }>([
    { $match: buildFilter(query) },
    { $group: { _id: null, count: { $sum: 1 }, totalPaise: { $sum: '$amountPaise' } } },
  ])
  return { count: row?.count ?? 0, totalPaise: row?.totalPaise ?? 0 }
}

export type BalanceReading = { balancePaise: number; asOf: Date } | null

/**
 * The most recent balance the bank quoted, admin only.
 *
 * A store manager needs to confirm that a customer's payment landed; the
 * business's bank balance is not part of that job, so this refuses rather
 * than relying on a page remembering not to render it.
 *
 * Deliberately ignores the page's date filter — "available balance" means
 * what is in the account now, and recomputing it from a filtered range would
 * quietly report a historical balance under a present-tense label.
 */
export async function latestBalance(ctx: AuthContext): Promise<BalanceReading> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may view the account balance.')

  await connectDb()
  const row = await Payment.findOne({ availableBalancePaise: { $ne: null } })
    .sort({ transactionDate: -1, receivedAt: -1 })
    .select('availableBalancePaise receivedAt')
    .lean()

  if (!row || row.availableBalancePaise == null) return null
  return { balancePaise: row.availableBalancePaise, asOf: row.receivedAt }
}

/**
 * Sets (or clears) a payment's remark.
 *
 * Open to admin and store manager alike — a manager is usually the one who
 * knows which order a name on a UPI credit belongs to, and a remark they
 * cannot write is a reconciliation that does not happen. Who wrote it and
 * when are recorded, so a disputed note has an author.
 */
export async function setPaymentRemark(
  ctx: AuthContext,
  paymentId: string,
  remark: string | null,
): Promise<void> {
  if (ctx.role !== 'ADMIN' && ctx.role !== 'STORE_MANAGER') {
    throw new ForbiddenError('You may not edit payment remarks.')
  }

  await connectDb()
  const res = await Payment.updateOne(
    { _id: paymentId },
    { $set: { remark, remarkById: ctx.userId, remarkAt: new Date() } },
  )
  if (res.matchedCount === 0) throw new NotFoundError('That payment no longer exists.')
}
