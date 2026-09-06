/**
 * Turns bank credit alerts already sitting in the unparsed inbox into
 * payments, and closes the inbox rows they came from.
 *
 * Before the payments page existed these alerts had nowhere to go, so every
 * one of them landed in the "needs attention" queue — an alarm that means
 * "an order is not being cooked" ringing for money arriving safely. This
 * clears the backlog in one pass.
 *
 * Idempotent, and safe to re-run: the unique index on `rrn` turns a
 * second run into a no-op rather than a duplicate row. Nothing is deleted —
 * the inbox rows are marked resolved and keep their raw email.
 *
 *   npm run backfill:payments            # show what would change
 *   npm run backfill:payments -- --apply # actually write
 *
 * Both npm scripts load .env.local. To run against another database, set
 * MONGODB_URI in the shell — Node's --env-file yields to an existing
 * environment variable, so the shell value wins:
 *
 *   MONGODB_URI="mongodb+srv://.../railserve?..." npm run backfill:payments
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { UnparsedInbox } from '../src/lib/models'
import { PAYMENT_PARSERS, recordPayment } from '../src/lib/ingest/payments'

const APPLY = process.argv.includes('--apply')

type Row = { body: string; receivedAt: Date }

/** The raw email as ingestEmail stored it, whatever shape that turned out to be. */
function readRawPayload(payload: unknown, fallbackDate: Date): Row {
  const p = (payload ?? {}) as { body?: unknown; receivedAt?: unknown }
  const receivedAt =
    p.receivedAt instanceof Date
      ? p.receivedAt
      : typeof p.receivedAt === 'string'
        ? new Date(p.receivedAt)
        : fallbackDate
  return {
    body: typeof p.body === 'string' ? p.body : '',
    receivedAt: Number.isNaN(receivedAt.getTime()) ? fallbackDate : receivedAt,
  }
}

async function main() {
  await connectDb()

  // Named before anything is scanned, for the same reason indexes.ts does it:
  // a backfill that quietly ran against the wrong database reports a tidy
  // "matched 0" and looks like there was nothing to do.
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)

  const rows = await UnparsedInbox.find({ resolved: false }).sort({ createdAt: 1 })
  console.log(`Scanning ${rows.length} unresolved inbox row${rows.length === 1 ? '' : 's'}.`)
  if (!APPLY) console.log('DRY RUN — pass --apply to write. Nothing will change.\n')

  let matched = 0
  let created = 0
  let duplicate = 0
  let unparseable = 0

  for (const row of rows) {
    const { body, receivedAt } = readRawPayload(row.rawPayload, row.createdAt)
    if (!body) continue

    const parser = PAYMENT_PARSERS.find((p) => p.matches(body))
    if (!parser) continue
    matched += 1

    const parsed = parser.parse(body, receivedAt)
    if (!parsed.ok) {
      // Left open on purpose. A credit alert this parser cannot read is
      // exactly what the inbox is for — resolving it would hide a real gap.
      unparseable += 1
      console.log(`  ! ${row._id}  ${parser.provider}: ${parsed.detail} — left for review`)
      continue
    }

    const p = parsed.payment
    const label = `${p.transactionDate}  ₹${(p.amountPaise / 100).toFixed(2)}  ${p.payerName}  ${p.rrn}`

    if (!APPLY) {
      console.log(`  · ${label}`)
      created += 1
      continue
    }

    const recorded = await recordPayment(
      p,
      row.rawPayload,
      // The inbox row already holds this message's gmailMessageId; reusing it
      // here would be honest but would collide on a re-run against a payment
      // written by the live pipeline. The RRN is the real identity anyway.
      null,
      receivedAt,
    )
    if (recorded.status === 'CREATED') created += 1
    else duplicate += 1

    await UnparsedInbox.updateOne(
      { _id: row._id },
      { $set: { resolved: true, resolvedAt: new Date() } },
    )
    console.log(`  ${recorded.status === 'CREATED' ? '✓' : '='} ${label}`)
  }

  console.log(
    `\n  scanned      ${rows.length}` +
      `\n  matched      ${matched} credit alert${matched === 1 ? '' : 's'}` +
      `\n  created      ${created}` +
      `\n  already had  ${duplicate}` +
      `\n  left open    ${unparseable}` +
      (APPLY ? `\n  resolved     ${created + duplicate} inbox rows` : '\n\nDRY RUN — nothing was written.'),
  )

  await disconnectDb()
}

main().catch((err) => {
  console.error('\nBackfill FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
