import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { User } from '../src/lib/models'
import { makeRestaurant, makeUser, resetDb } from './fixtures'

// Same fake-session pattern as sessionFresh.test.ts: staffActions.ts calls
// requireRole() internally, which reads the session, so the session is what
// gets faked rather than passing a ctx directly.
const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/auth', () => ({ auth: async () => session.current }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { saveUser, toggleUserActive } from '../src/app/admin/setup/staffActions'

function loginAs(user: { _id: unknown }, role: string, restaurantIds: string[]) {
  session.current = { user: { id: String(user._id), role, restaurantIds, name: 'x' } }
}

function formOf(fields: Record<string, string | string[]>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item)
    else fd.set(k, v)
  }
  return fd
}

describe('store manager staff scoping', () => {
  beforeAll(resetDb)
  beforeEach(resetDb)
  afterAll(disconnectDb)

  it('creates a DELIVERY_AGENT rider at their own outlet', async () => {
    const mine = await makeRestaurant('MINE', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9300000001', mine._id)
    loginAs(manager, 'STORE_MANAGER', [String(mine._id)])

    const result = await saveUser(
      {},
      formOf({
        name: 'New Rider',
        phone: '9300000002',
        role: 'DELIVERY_AGENT',
        restaurantIds: [String(mine._id)],
        password: 'secret123',
      }),
    )

    expect(result.ok).toBeTruthy()
    const created = await User.findOne({ phone: '9300000002' }).lean()
    expect(created?.role).toBe('DELIVERY_AGENT')
  })

  it('refuses to create any role other than DELIVERY_AGENT', async () => {
    const mine = await makeRestaurant('MINE', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9300000003', mine._id)
    loginAs(manager, 'STORE_MANAGER', [String(mine._id)])

    const result = await saveUser(
      {},
      formOf({
        name: 'Sneaky Telecaller',
        phone: '9300000004',
        role: 'TELECALLER',
        restaurantIds: [String(mine._id)],
        password: 'secret123',
      }),
    )

    expect(result.error).toMatch(/only add or edit riders/i)
    expect(await User.findOne({ phone: '9300000004' }).lean()).toBeNull()
  })

  it('refuses to assign an outlet outside their own', async () => {
    const mine = await makeRestaurant('MINE', 'CNB')
    const other = await makeRestaurant('OTHER', 'PRYJ')
    const manager = await makeUser('STORE_MANAGER', '9300000005', mine._id)
    loginAs(manager, 'STORE_MANAGER', [String(mine._id)])

    const result = await saveUser(
      {},
      formOf({
        name: 'Rider',
        phone: '9300000006',
        role: 'DELIVERY_AGENT',
        restaurantIds: [String(other._id)],
        password: 'secret123',
      }),
    )

    expect(result.error).toMatch(/outlets you hold yourself/i)
  })

  it('refuses to edit a user who is not already their own rider', async () => {
    const mine = await makeRestaurant('MINE', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9300000007', mine._id)
    const someoneElse = await makeUser('TELECALLER', '9300000008', mine._id)
    loginAs(manager, 'STORE_MANAGER', [String(mine._id)])

    const result = await saveUser(
      {},
      formOf({
        id: String(someoneElse._id),
        name: 'Taken Over',
        phone: '9300000008',
        role: 'DELIVERY_AGENT',
        restaurantIds: [String(mine._id)],
      }),
    )

    expect(result.error).toMatch(/not a rider at one of your outlets/i)
    expect((await User.findById(someoneElse._id).lean())?.role).toBe('TELECALLER')
  })

  it('toggleUserActive refuses a target outside the manager’s own riders', async () => {
    const mine = await makeRestaurant('MINE', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9300000009', mine._id)
    const notMyRider = await makeUser('TELECALLER', '9300000010', mine._id)
    loginAs(manager, 'STORE_MANAGER', [String(mine._id)])

    // toggleUserActive returns void by design — a store manager only ever
    // sees this button next to their own riders, so a refusal here is
    // defence in depth and simply does nothing rather than surfacing an
    // error nobody should ever hit through the UI.
    await toggleUserActive(formOf({ id: String(notMyRider._id), active: 'false' }))
    expect((await User.findById(notMyRider._id).lean())?.active).toBe(true)
  })

  it('toggleUserActive works on their own rider', async () => {
    const mine = await makeRestaurant('MINE', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9300000011', mine._id)
    const myRider = await makeUser('DELIVERY_AGENT', '9300000012', mine._id)
    loginAs(manager, 'STORE_MANAGER', [String(mine._id)])

    await toggleUserActive(formOf({ id: String(myRider._id), active: 'false' }))
    expect((await User.findById(myRider._id).lean())?.active).toBe(false)
  })

  it('deleteUser is out of reach for a store manager entirely — no UI, no server path', async () => {
    const mine = await makeRestaurant('MINE', 'CNB')
    const manager = await makeUser('STORE_MANAGER', '9300000013', mine._id)
    const myRider = await makeUser('DELIVERY_AGENT', '9300000014', mine._id)
    loginAs(manager, 'STORE_MANAGER', [String(mine._id)])

    const { deleteUser } = await import('../src/app/admin/setup/staffActions')
    await expect(deleteUser({}, formOf({ id: String(myRider._id) }))).rejects.toThrow(/^REDIRECT:/)
    expect(await User.findById(myRider._id).lean()).not.toBeNull()
  })
})
