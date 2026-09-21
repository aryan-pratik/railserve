import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import {
  appendCallNote,
  countOrdersForOutlet,
  countOrdersRecordingUser,
} from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * The counts that decide whether a setup row may be deleted.
 *
 * Plan §2: an order pointing at a record that no longer exists vanishes from
 * every dashboard with no error anywhere. These counts are the only thing
 * between the delete button and that, so an undercount is the failure that
 * matters: every place a user's id can be written must be counted.
 */
describe('setup delete guards', () => {
  let admin: AuthContext
  let manager: AuthContext
  let used: import('mongoose').Types.ObjectId
  let unused: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    used = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    unused = (await makeRestaurant('NEVER USED', 'CNB'))._id
    admin = ctxFor(await makeUser('ADMIN', '9200000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9200000002', used))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('counts the orders an outlet holds, and none for an unused one', async () => {
    await makeOrder({ restaurantId: used })
    await makeOrder({ restaurantId: used })
    expect(await countOrdersForOutlet(admin, String(used))).toBe(2)
    expect(await countOrdersForOutlet(admin, String(unused))).toBe(0)
  })

  it('finds a user through an event they recorded', async () => {
    const o = await makeOrder({ restaurantId: used })
    const u = ctxFor(await makeUser('STORE_MANAGER', '9200000003', used))
    expect(await countOrdersRecordingUser(admin, String(u.userId))).toBe(0)
    await transitionOrder({ ctx: u, orderId: String(o._id), to: 'ACCEPTED' })
    expect(await countOrdersRecordingUser(admin, String(u.userId))).toBe(1)
  })

  it('finds a user through a call note alone', async () => {
    const o = await makeOrder({ restaurantId: used })
    const t = ctxFor(await makeUser('TELECALLER', '9200000004', used))
    await appendCallNote(t, String(o._id), 'Passenger asked for coach B2')
    expect(await countOrdersRecordingUser(admin, String(t.userId))).toBe(1)
  })

  it('finds a user through delivery and through order creation', async () => {
    const rider = await makeUser('DELIVERY_AGENT', '9200000005', used)
    const creator = await makeUser('STORE_MANAGER', '9200000006', used)
    await makeOrder({ restaurantId: used, delivery: { agentIds: [rider._id] } })
    await makeOrder({ restaurantId: used, createdById: creator._id })
    expect(await countOrdersRecordingUser(admin, String(rider._id))).toBe(1)
    expect(await countOrdersRecordingUser(admin, String(creator._id))).toBe(1)
  })

  it('reports nothing for a user who never touched an order', async () => {
    const fresh = await makeUser('TELECALLER', '9200000007', used)
    expect(await countOrdersRecordingUser(admin, String(fresh._id))).toBe(0)
  })

  it('answers only an admin, who alone can see every outlet', async () => {
    await expect(countOrdersForOutlet(manager, String(used))).rejects.toBeInstanceOf(ForbiddenError)
    await expect(countOrdersRecordingUser(manager, String(manager.userId))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})
