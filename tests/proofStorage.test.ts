import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById } from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import {
  getProofStore,
  isAllowedContentType,
  isProofStorageConfigured,
  ProofStoreUnavailable,
} from '../src/lib/storage'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import type { AuthContext } from '../src/lib/authContext'

/**
 * Photo proof is optional, so "no bucket configured" is a supported state, not
 * a broken one. These pin that: the app keeps working, delivery still closes,
 * and nothing throws at import time.
 */
describe('delivery proof storage', () => {
  let rider: AuthContext
  let manager: AuthContext
  let orderId: string

  beforeAll(async () => {
    await resetDb()
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))
    rider = ctxFor(await makeUser('DELIVERY_AGENT', '9000000004', r._id))

    const o = await makeOrder({ restaurantId: r._id, stationCode: 'CNB' })
    orderId = String(o._id)
    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId, to })
    }
    await transitionOrder({ ctx: rider, orderId, to: 'DISPATCHED' })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('only accepts real image content types', () => {
    expect(isAllowedContentType('image/jpeg')).toBe(true)
    expect(isAllowedContentType('image/png')).toBe(true)
    expect(isAllowedContentType('image/webp')).toBe(true)
    // The interesting cases: things that would otherwise be happily stored.
    expect(isAllowedContentType('image/svg+xml')).toBe(false)
    expect(isAllowedContentType('text/html')).toBe(false)
    expect(isAllowedContentType('application/pdf')).toBe(false)
    expect(isAllowedContentType('')).toBe(false)
  })

  it('reports itself unconfigured rather than crashing when R2 is unset', () => {
    // The suite runs with no R2_* variables, which is the default deployment.
    expect(isProofStorageConfigured()).toBe(false)
    expect(getProofStore().name).toBe('none')
  })

  it('refuses to presign when unconfigured, with an actionable message', async () => {
    await expect(
      getProofStore().presignUpload({ orderId, contentType: 'image/jpeg' }),
    ).rejects.toBeInstanceOf(ProofStoreUnavailable)
  })

  it('a delivery still closes with no photo at all', async () => {
    const done = await transitionOrder({
      ctx: rider, orderId, to: 'DELIVERED',
      apply: { proofType: 'SIGNATURE', proofValue: 'Neelesh Soni' },
    })
    expect(done.status).toBe('DELIVERED')
    expect(done.delivery.proofType).toBe('SIGNATURE')
  })

  it('stores the object key, never a presigned URL', async () => {
    // A URL would be dead within the hour; the key is the durable handle.
    const order = await findById(rider, orderId)
    expect(order!.delivery.proofValue).not.toMatch(/^https?:\/\//)
  })
})
