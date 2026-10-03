import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById } from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import {
  approveCancellation,
  listPendingCancelRequests,
  refuseCancellation,
  requestCancellation,
  viewCancelRequest,
} from '../src/lib/repo/cancelRequestRepo'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { canRequestCancellation } from '../src/lib/orderStatus'
import { assignRider, ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * A store manager asks for a cancellation with a reason; a telecaller or an
 * admin accepts (the order is cancelled) or refuses (it carries on).
 */
describe('cancellation requests', () => {
  let manager: AuthContext
  let otherManager: AuthContext
  let telecaller: AuthContext
  let otherTelecaller: AuthContext
  let admin: AuthContext
  let agent: AuthContext
  let ganga: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    ganga = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    const annapurna = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id

    manager = ctxFor(await makeUser('STORE_MANAGER', '9100000001', ganga))
    otherManager = ctxFor(await makeUser('STORE_MANAGER', '9100000002', annapurna))
    telecaller = ctxFor(await makeUser('TELECALLER', '9100000003', ganga))
    otherTelecaller = ctxFor(await makeUser('TELECALLER', '9100000004', annapurna))
    admin = ctxFor(await makeUser('ADMIN', '9100000005'))
    agent = ctxFor(await makeUser('DELIVERY_AGENT', '9100000006', ganga))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  async function newOrder() {
    return String((await makeOrder({ restaurantId: ganga, stationCode: 'CNB' }))._id)
  }

  it('is open to a store manager only, and only while a cancel could be accepted', () => {
    expect(canRequestCancellation('STORE_MANAGER', 'RECEIVED')).toBe(true)
    expect(canRequestCancellation('STORE_MANAGER', 'PREPARED')).toBe(true)
    expect(canRequestCancellation('STORE_MANAGER', 'DELIVERED')).toBe(false)
    expect(canRequestCancellation('STORE_MANAGER', 'CANCELLED')).toBe(false)
    expect(canRequestCancellation('TELECALLER', 'RECEIVED')).toBe(false)
    expect(canRequestCancellation('ADMIN', 'RECEIVED')).toBe(false)
  })

  it('records the request and lists it for the telecaller and the admin', async () => {
    const id = await newOrder()
    await requestCancellation(manager, id, '  Paneer finished  ')

    const order = (await findById(manager, id))!
    expect(order.status).toBe('RECEIVED')
    expect(order.cancelRequest).toMatchObject({ status: 'PENDING', reason: 'Paneer finished' })
    expect(order.events.at(-1)!.meta).toMatchObject({
      action: 'CANCEL_REQUESTED',
      reason: 'Paneer finished',
    })

    const forTelecaller = await listPendingCancelRequests(telecaller)
    expect(forTelecaller.map((r) => r.id)).toContain(id)
    expect((await listPendingCancelRequests(admin)).map((r) => r.id)).toContain(id)
    // Scoped: another outlet's call desk never sees it.
    expect((await listPendingCancelRequests(otherTelecaller)).map((r) => r.id)).not.toContain(id)

    const view = await viewCancelRequest(order)
    expect(view).toMatchObject({ status: 'PENDING', requestedBy: 'STORE_MANAGER 9100000001 · Store manager' })
  })

  it('requires a reason', async () => {
    const id = await newOrder()
    await expect(requestCancellation(manager, id, '  ')).rejects.toThrow(/why/)
    expect((await findById(manager, id))!.cancelRequest ?? null).toBeNull()
  })

  it('refuses a second request while one is waiting', async () => {
    const id = await newOrder()
    await requestCancellation(manager, id, 'Item finished')
    await expect(requestCancellation(manager, id, 'Again')).rejects.toThrow(ConflictError)
  })

  it('refuses roles other than a store manager, and other outlets', async () => {
    const id = await newOrder()
    await expect(requestCancellation(telecaller, id, 'Item finished')).rejects.toThrow(ForbiddenError)
    await expect(requestCancellation(admin, id, 'Item finished')).rejects.toThrow(ForbiddenError)
    await expect(requestCancellation(otherManager, id, 'Item finished')).rejects.toThrow(NotFoundError)
  })

  it('cannot be raised once the order is over', async () => {
    const id = await newOrder()
    await transitionOrder({ ctx: telecaller, orderId: id, to: 'CANCELLED' })
    await expect(requestCancellation(manager, id, 'Item finished')).rejects.toThrow(ConflictError)
  })

  it('accepting cancels the order, with the manager reason on the cancel event', async () => {
    const id = await newOrder()
    await transitionOrder({ ctx: manager, orderId: id, to: 'ACCEPTED' })
    await requestCancellation(manager, id, 'Kitchen cannot make it in time')
    await approveCancellation(telecaller, id)

    const order = (await findById(manager, id))!
    expect(order.status).toBe('CANCELLED')
    expect(order.cancelRequest).toMatchObject({ status: 'APPROVED' })
    expect(String(order.cancelRequest!.decidedBy)).toBe(String(telecaller.userId))
    const cancel = order.events.at(-1)!
    expect(cancel.toStatus).toBe('CANCELLED')
    expect(cancel.meta).toMatchObject({ via: 'cancel-request', reason: 'Kitchen cannot make it in time' })

    expect((await listPendingCancelRequests(admin)).map((r) => r.id)).not.toContain(id)
  })

  it('an admin can accept too, even after the order went out with a rider', async () => {
    const id = await newOrder()
    await requestCancellation(manager, id, 'Train diverted')
    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId: id, to })
    }
    await assignRider(id, agent.userId)
    await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })

    await approveCancellation(admin, id)
    expect((await findById(admin, id))!.status).toBe('CANCELLED')
  })

  it('refusing leaves the order alone, keeps the note, and lets the manager ask again', async () => {
    const id = await newOrder()
    await requestCancellation(manager, id, 'Item finished')
    await refuseCancellation(admin, id, 'Passenger still wants it')

    let order = (await findById(manager, id))!
    expect(order.status).toBe('RECEIVED')
    expect(order.cancelRequest).toMatchObject({
      status: 'REFUSED',
      decisionNote: 'Passenger still wants it',
    })
    expect(order.events.at(-1)!.meta).toMatchObject({
      action: 'CANCEL_REFUSED',
      reason: 'Passenger still wants it',
    })
    expect((await listPendingCancelRequests(admin)).map((r) => r.id)).not.toContain(id)

    await requestCancellation(manager, id, 'Still finished, nothing to substitute')
    order = (await findById(manager, id))!
    expect(order.cancelRequest).toMatchObject({ status: 'PENDING', decisionNote: null })
  })

  it('only a telecaller or an admin answers, and only a pending request', async () => {
    const id = await newOrder()
    await expect(approveCancellation(telecaller, id)).rejects.toThrow(ConflictError)
    await expect(refuseCancellation(telecaller, id, '')).rejects.toThrow(ConflictError)

    await requestCancellation(manager, id, 'Item finished')
    await expect(approveCancellation(manager, id)).rejects.toThrow(ForbiddenError)
    await expect(refuseCancellation(manager, id, '')).rejects.toThrow(ForbiddenError)
    await expect(approveCancellation(otherTelecaller, id)).rejects.toThrow(NotFoundError)
  })
})
