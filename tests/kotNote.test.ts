import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById, setKotNote, updateOrderFields, KOT_NOTE_MAX } from '../src/lib/repo/orderRepo'
import { ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { assignRider, ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * The KOT note: a telecaller's (or admin's) instruction that prints on the
 * ticket — unlike the call log, overwritable, so these tests care about
 * replacement rather than accumulation, and about the neighbouring fields a
 * write here must leave alone.
 */
describe('KOT note', () => {
  let telecaller: AuthContext
  let otherTelecaller: AuthContext
  let admin: AuthContext
  let manager: AuthContext
  let agent: AuthContext
  let ganga: import('mongoose').Types.ObjectId
  let annapurna: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const a = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    ganga = g._id
    annapurna = a._id

    admin = ctxFor(await makeUser('ADMIN', '9200000001'))
    telecaller = ctxFor(await makeUser('TELECALLER', '9200000002', ganga))
    otherTelecaller = ctxFor(await makeUser('TELECALLER', '9200000003', annapurna))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9200000004', ganga))
    agent = ctxFor(await makeUser('DELIVERY_AGENT', '9200000005', ganga))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  async function newOrder(overrides: Record<string, unknown> = {}) {
    const o = await makeOrder({ restaurantId: ganga, stationCode: 'CNB', ...overrides })
    return String(o._id)
  }

  const noteOn = async (ctx: AuthContext, id: string) => (await findById(ctx, id))!.kotNote

  it('is null until someone sets it', async () => {
    const id = await newOrder()
    expect(await noteOn(telecaller, id)).toBeNull()
  })

  it('lets a telecaller set it', async () => {
    const id = await newOrder()
    await setKotNote(telecaller, id, 'Call before leaving the platform')
    expect(await noteOn(telecaller, id)).toBe('Call before leaving the platform')
  })

  it('lets an admin set it too', async () => {
    const id = await newOrder()
    await setKotNote(admin, id, 'From the desk')
    expect(await noteOn(admin, id)).toBe('From the desk')
  })

  it('overwrites rather than accumulating — unlike the call log', async () => {
    const id = await newOrder()
    await setKotNote(telecaller, id, 'First note')
    await setKotNote(telecaller, id, 'Corrected note')
    expect(await noteOn(telecaller, id)).toBe('Corrected note')
  })

  it('clears to null on an empty string', async () => {
    const id = await newOrder()
    await setKotNote(telecaller, id, 'Something')
    await setKotNote(telecaller, id, '')
    expect(await noteOn(telecaller, id)).toBeNull()
  })

  it('trims, and clears on whitespace alone', async () => {
    const id = await newOrder()
    await setKotNote(telecaller, id, '  padded  ')
    expect(await noteOn(telecaller, id)).toBe('padded')

    await setKotNote(telecaller, id, '   ')
    expect(await noteOn(telecaller, id)).toBeNull()
  })

  it('refuses an over-long note, and changes nothing', async () => {
    // updateOne runs no document validators, so the repository's own length
    // check is the only thing standing here.
    const id = await newOrder()
    await setKotNote(telecaller, id, 'Keep me')
    await expect(setKotNote(telecaller, id, 'x'.repeat(KOT_NOTE_MAX + 1))).rejects.toThrow()
    expect(await noteOn(telecaller, id)).toBe('Keep me')
  })

  describe('refusals', () => {
    it('refuses a store manager', async () => {
      const id = await newOrder()
      await expect(setKotNote(manager, id, 'nope')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses a rider', async () => {
      const id = await newOrder()
      await expect(setKotNote(agent, id, 'nope')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('gives another outlet’s telecaller a 404, not a refusal', async () => {
      // A ForbiddenError here would itself confirm the order exists.
      const id = await newOrder()
      await expect(setKotNote(otherTelecaller, id, 'not mine')).rejects.toBeInstanceOf(
        NotFoundError,
      )
      expect(await noteOn(telecaller, id)).toBeNull()
    })

    it('treats a malformed id as a 404', async () => {
      await expect(setKotNote(telecaller, 'not-an-id', 'x')).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('lets a store manager and a rider read it, but not write it', async () => {
    const id = await newOrder()
    await setKotNote(telecaller, id, 'Visible to the kitchen')
    // A rider reads only what is assigned to them.
    await assignRider(id, agent.userId)
    expect(await noteOn(manager, id)).toBe('Visible to the kitchen')
    expect(await noteOn(agent, id)).toBe('Visible to the kitchen')
  })

  it('leaves remark, notes and the call log alone', async () => {
    const id = await newOrder({ remark: 'Less spicy', notes: 'Gate 3 handover' })
    const before = await findById(telecaller, id)

    await setKotNote(telecaller, id, 'Prints on the ticket')

    const after = await findById(telecaller, id)
    expect(after!.remark).toBe('Less spicy')
    expect(after!.notes).toBe('Gate 3 handover')
    expect(after!.callLog).toHaveLength(before!.callLog.length)
  })

  it('cannot be replaced through the general field updater', async () => {
    const id = await newOrder()
    await setKotNote(telecaller, id, 'Keep me')

    await expect(updateOrderFields(admin, id, { kotNote: 'sneaked in' })).rejects.toThrow()
    expect(await noteOn(telecaller, id)).toBe('Keep me')
  })
})
