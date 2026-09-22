/**
 * One-shot migration: renames the legacy free-text custom statuses an admin
 * once typed into the "Add a new status..." editor on /admin/orders —
 * `MISSED_DELEVERY` (typo, as typed) and `REFUND` — onto the new formal
 * `MISSED_DELIVERY` and `REFUNDED` statuses now that these are first-class
 * ORDER_STATUSES with their own TRANSITIONS edges, colours, and labels.
 *
 * Rewrites both the order's current `status` (when it still equals the
 * legacy string) and any historical `events[].fromStatus`/`toStatus` entries
 * that recorded it, so old rows render with the corrected label/colour going
 * forward instead of showing the typo forever through the generic fallback
 * formatter.
 *
 * Direct field writes, not transitionOrder() calls: there is no `ctx`/actor
 * for a migration script, and the normal guards (TRANSITIONS, rider-naming,
 * optimistic concurrency) exist to keep the guided pipeline honest — they
 * don't apply to renaming a value that was never really in that pipeline to
 * begin with, same reasoning adminOverrideStatus already relies on.
 *
 * Idempotent: re-running matches zero documents on the second pass.
 *
 *   npm run migrate:legacy-statuses
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Order } from '../src/lib/models'

const RENAMES: Record<string, string> = {
  MISSED_DELEVERY: 'MISSED_DELIVERY',
  REFUND: 'REFUNDED',
}

export type LegacyStatusMigrationReport = {
  ordersRenamed: Record<string, number>
  eventsRewritten: number
}

export async function migrateLegacyStatuses(): Promise<LegacyStatusMigrationReport> {
  const report: LegacyStatusMigrationReport = { ordersRenamed: {}, eventsRewritten: 0 }

  for (const [legacy, correct] of Object.entries(RENAMES)) {
    const statusResult = await Order.updateMany({ status: legacy }, { $set: { status: correct } })
    report.ordersRenamed[legacy] = statusResult.modifiedCount

    const toResult = await Order.updateMany(
      { 'events.toStatus': legacy },
      { $set: { 'events.$[e].toStatus': correct } },
      { arrayFilters: [{ 'e.toStatus': legacy }] },
    )
    const fromResult = await Order.updateMany(
      { 'events.fromStatus': legacy },
      { $set: { 'events.$[e].fromStatus': correct } },
      { arrayFilters: [{ 'e.fromStatus': legacy }] },
    )
    report.eventsRewritten += toResult.modifiedCount + fromResult.modifiedCount
  }

  return report
}

async function main() {
  await connectDb()
  const report = await migrateLegacyStatuses()

  for (const [legacy, count] of Object.entries(report.ordersRenamed)) {
    console.log(`~ ${legacy} -> ${RENAMES[legacy]}: ${count} order(s) renamed`)
  }
  console.log(`events rewritten: ${report.eventsRewritten}`)

  await disconnectDb()
}

// Only when run directly, so importing this from a test does not connect.
if (process.argv[1]?.includes('migrate-legacy-statuses')) {
  main().catch((err) => {
    console.error('\nMigration FAILED:', err.message)
    process.exit(1)
  })
}
