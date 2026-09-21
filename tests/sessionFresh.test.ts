import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { User } from '../src/lib/models'
import { makeRestaurant, makeUser, resetDb } from './fixtures'

// The session is the only thing faked: it carries what a stale cookie would —
// the outlets and role frozen at login.
const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/auth', () => ({ auth: async () => session.current }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))

import { getAuthContext, requireAuth } from '../src/lib/session'

function cookieFor(user: { _id: unknown }, role: string, restaurantIds: string[]) {
  session.current = { user: { id: String(user._id), role, restaurantIds, name: 'x' } }
}

describe('session reflects the database, not the login cookie', () => {
  beforeAll(resetDb)
  beforeEach(resetDb)
  afterAll(disconnectDb)

  it('picks up an outlet assigned after login', async () => {
    const a = await makeRestaurant('A', 'CNB')
    const b = await makeRestaurant('B', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9000000001', a._id)
    cookieFor(manager, 'STORE_MANAGER', [String(a._id)])

    await User.updateOne({ _id: manager._id }, { restaurantIds: [a._id, b._id] })

    const ctx = await getAuthContext()
    expect(ctx?.restaurantIds.map(String)).toEqual([String(a._id), String(b._id)])
  })

  it('drops an outlet removed after login', async () => {
    const a = await makeRestaurant('A', 'CNB')
    const b = await makeRestaurant('B', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9000000002', [a._id, b._id])
    cookieFor(manager, 'STORE_MANAGER', [String(a._id), String(b._id)])

    await User.updateOne({ _id: manager._id }, { restaurantIds: [a._id] })

    expect((await getAuthContext())?.restaurantIds.map(String)).toEqual([String(a._id)])
  })

  it('uses the current role, not the one in the cookie', async () => {
    const manager = await makeUser('STORE_MANAGER', '9000000003', null)
    cookieFor(manager, 'ADMIN', [])
    expect((await getAuthContext())?.role).toBe('STORE_MANAGER')
  })

  it('refuses a deactivated user and clears their cookie', async () => {
    const manager = await makeUser('STORE_MANAGER', '9000000004', null)
    cookieFor(manager, 'STORE_MANAGER', [])
    await User.updateOne({ _id: manager._id }, { active: false })

    expect(await getAuthContext()).toBeNull()
    await expect(requireAuth()).rejects.toThrow('REDIRECT:/api/session/reset')
  })

  it('refuses a deleted user and clears their cookie', async () => {
    const manager = await makeUser('STORE_MANAGER', '9000000005', null)
    cookieFor(manager, 'STORE_MANAGER', [])
    await User.deleteOne({ _id: manager._id })

    await expect(requireAuth()).rejects.toThrow('REDIRECT:/api/session/reset')
  })

  it('sends a caller with no cookie to plain /login', async () => {
    session.current = null
    await expect(requireAuth()).rejects.toThrow('REDIRECT:/login')
  })

  it('rejects a malformed user id in the cookie without querying', async () => {
    session.current = { user: { id: 'not-an-id', role: 'ADMIN', restaurantIds: [] } }
    expect(await getAuthContext()).toBeNull()
    expect(mongoose.isValidObjectId('not-an-id')).toBe(false)
  })
})
