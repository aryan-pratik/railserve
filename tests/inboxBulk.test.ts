import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { Order, UnparsedInbox } from '../src/lib/models'
import { ingestEmail } from '../src/lib/ingest'
import { readInboxFilter } from '../src/lib/inbox'
import {
  dismissInboxRows,
  reingestInboxRow,
  reingestInboxRows,
  reopenInboxRows,
} from '../src/lib/repo/inboxRepo'
import { ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { ctxFor, makeRestaurant, makeUser, resetDb } from './fixtures'
import * as fx from './fixtures/yatriRestro'

const RECEIVED = new Date('2026-08-27T08:00:00Z')

/** Files one email in the inbox and returns its row id. */
async function unparsed(body: string, from = 'orders@yatrirestro.example', subject = 'New order') {
  const r = await ingestEmail({ body, receivedAt: RECEIVED, subject, from })
  if (r.status !== 'UNPARSED') throw new Error(`expected UNPARSED, got ${r.status}`)
  return r.inboxId
}

/**
 * Working the unparsed inbox many rows at a time: dismissing, re-ingesting
 * and undoing, with who did it and which click it was recorded on each row.
 */
describe('inbox bulk actions', () => {
  let admin: AuthContext
  let telecaller: AuthContext

  beforeEach(async () => {
    await resetDb()
    admin = ctxFor(await makeUser('ADMIN', '9400000001'))
    const ganga = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    telecaller = ctxFor(await makeUser('TELECALLER', '9400000002', ganga._id))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('dismisses the ticked rows, records who and the batch, and undo takes back exactly that batch', async () => {
    const a = await unparsed(fx.GARBAGE + ' a')
    const b = await unparsed(fx.GARBAGE + ' b')
    const c = await unparsed(fx.GARBAGE + ' c')

    const r = await dismissInboxRows(admin, { ids: [a, b, 'not-an-id'] })
    expect(r.count).toBe(2)
    expect(r.bulkActionId).toBeTruthy()

    const rowA = await UnparsedInbox.findById(a).lean()
    expect(rowA).toMatchObject({ resolved: true, resolution: 'DISMISSED', bulkActionCount: 2 })
    expect(String(rowA!.resolvedById)).toBe(String(admin.userId))
    expect((await UnparsedInbox.findById(c).lean())!.resolved).toBe(false)

    // A second dismiss of the same rows changes nothing.
    expect((await dismissInboxRows(admin, { ids: [a, b] })).count).toBe(0)

    // Another batch, then undo the first: the second stays dismissed.
    const second = await dismissInboxRows(admin, { ids: [c] })
    expect(await reopenInboxRows(admin, { bulkActionId: r.bulkActionId! })).toBe(2)
    expect(await UnparsedInbox.countDocuments({ resolved: false })).toBe(2)
    expect((await UnparsedInbox.findById(a).lean())).toMatchObject({
      resolved: false, resolution: null, resolvedById: null, bulkActionId: null,
    })
    expect((await UnparsedInbox.findById(c).lean())!.bulkActionId).toBe(second.bulkActionId)
  })

  it('dismisses every row matching the filters, and only those', async () => {
    await unparsed(fx.GARBAGE, 'promo@shop.example', 'Big sale')
    await unparsed(fx.GARBAGE + ' 2', 'promo@shop.example', 'Bigger sale')
    const keep = await unparsed(fx.UNKNOWN_OUTLET)

    const r = await dismissInboxRows(admin, { filter: readInboxFilter({ sender: 'promo@shop.example' }) })
    expect(r.count).toBe(2)
    expect((await UnparsedInbox.findById(keep).lean())!.resolved).toBe(false)

    // The filter's own tab is ignored: a dismiss only ever closes open rows.
    const again = await dismissInboxRows(admin, { filter: readInboxFilter({ show: 'resolved' }) })
    expect(again.count).toBe(1)
  })

  it('re-ingests rows as they are: the fixed ones become orders, the rest stay open', async () => {
    const outlet = await unparsed(fx.UNKNOWN_OUTLET)
    const junk = await unparsed(fx.GARBAGE)
    // The fix an admin makes before clicking Re-ingest: add the outlet.
    await makeRestaurant('SOME RANDOM DHABA', 'CNB')

    const r = await reingestInboxRows(admin, { ids: [outlet, junk] })
    expect(r).toMatchObject({ resolved: 1, failed: 1, remaining: 0 })
    expect(r.errors[0]).toMatch(/No parser/)

    const row = await UnparsedInbox.findById(outlet).lean()
    expect(row).toMatchObject({ resolved: true, resolution: 'ORDER' })
    const order = await Order.findById(row!.resolvedOrderId).lean()
    expect(order?.externalOrderId).toBe('1000585333')
    expect((await UnparsedInbox.findById(junk).lean())!.resolved).toBe(false)

    // A row that became an order can never be reopened into a second one.
    expect(await reopenInboxRows(admin, { ids: [outlet] })).toBe(0)
  })

  it('re-ingesting a row whose order already exists links it rather than failing', async () => {
    const id = await unparsed(fx.UNKNOWN_OUTLET)
    await makeRestaurant('SOME RANDOM DHABA', 'CNB')
    await ingestEmail({ body: fx.UNKNOWN_OUTLET, receivedAt: RECEIVED, from: 'orders@yatrirestro.example' })

    const r = await reingestInboxRow(admin, id, fx.UNKNOWN_OUTLET)
    expect(r.ok).toMatch(/already existed/)
    const row = await UnparsedInbox.findById(id).lean()
    expect(row!.resolvedOrderId).not.toBeNull()
  })

  it('is admin-only', async () => {
    const id = await unparsed(fx.GARBAGE)
    await expect(dismissInboxRows(telecaller, { ids: [id] })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(reingestInboxRows(telecaller, { ids: [id] })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(reopenInboxRows(telecaller, { ids: [id] })).rejects.toBeInstanceOf(ForbiddenError)
  })
})
