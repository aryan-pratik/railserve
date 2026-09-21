import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import {
  appendCallNote,
  deleteCallNote,
  editCallNote,
  findById,
  listCallNotes,
  updateOrderFields,
  CALL_NOTE_MAX,
  CALL_LOG_LIMIT,
} from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * The call log: what the passenger said on the phone.
 *
 * A telecaller rings the same order more than once, so a note never overwrites
 * the one before it. Correcting or withdrawing a note is deliberate and belongs
 * to whoever wrote it, or to an admin; these tests care as much about who
 * cannot do that as about who can, and about the neighbouring fields a write
 * here must leave alone.
 */
describe('call log', () => {
  let telecaller: AuthContext
  let otherTelecaller: AuthContext
  let admin: AuthContext
  let manager: AuthContext
  let otherManager: AuthContext
  let agent: AuthContext
  let ganga: import('mongoose').Types.ObjectId
  let annapurna: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const a = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    ganga = g._id
    annapurna = a._id

    admin = ctxFor(await makeUser('ADMIN', '9100000001'))
    telecaller = ctxFor(await makeUser('TELECALLER', '9100000002', ganga))
    otherTelecaller = ctxFor(await makeUser('TELECALLER', '9100000003', annapurna))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9100000004', ganga))
    otherManager = ctxFor(await makeUser('STORE_MANAGER', '9100000005', annapurna))
    agent = ctxFor(await makeUser('DELIVERY_AGENT', '9100000006', ganga))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  async function newOrder(overrides: Record<string, unknown> = {}) {
    const o = await makeOrder({ restaurantId: ganga, stationCode: 'CNB', ...overrides })
    return String(o._id)
  }

  const logOf = async (ctx: AuthContext, id: string) => (await findById(ctx, id))!.callLog

  describe('writing', () => {
    it('lands with the author and a timestamp', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Passenger asked for coach B2')

      const log = await logOf(telecaller, id)
      expect(log).toHaveLength(1)
      expect(log[0].text).toBe('Passenger asked for coach B2')
      expect(String(log[0].userId)).toBe(String(telecaller.userId))
      expect(log[0].createdAt).toBeInstanceOf(Date)
    })

    it('accumulates — a second note never overwrites the first', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'No answer, will retry')
      await appendCallNote(telecaller, id, 'Reached them, order stands')

      expect((await logOf(telecaller, id)).map((n) => n.text)).toEqual([
        'No answer, will retry',
        'Reached them, order stands',
      ])
    })

    it('takes a note from an admin too, distinguishable from the telecaller’s', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'From the desk')
      await appendCallNote(admin, id, 'From the admin')

      const log = await logOf(admin, id)
      expect(log.map((n) => String(n.userId))).toEqual([
        String(telecaller.userId),
        String(admin.userId),
      ])
    })

    it('trims, and refuses whitespace alone', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, '  padded  ')
      expect((await logOf(telecaller, id))[0].text).toBe('padded')

      await expect(appendCallNote(telecaller, id, '   ')).rejects.toThrow()
      expect(await logOf(telecaller, id)).toHaveLength(1)
    })

    it('refuses an over-long note, and appends nothing', async () => {
      // updateOne runs no subdocument validators, so the repository's own
      // length check is the only thing standing here.
      const id = await newOrder()
      await expect(
        appendCallNote(telecaller, id, 'x'.repeat(CALL_NOTE_MAX + 1)),
      ).rejects.toThrow()
      expect(await logOf(telecaller, id)).toHaveLength(0)
    })
  })

  describe('refusals', () => {
    it('refuses a store manager', async () => {
      const id = await newOrder()
      await expect(appendCallNote(manager, id, 'nope')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses a rider', async () => {
      const id = await newOrder()
      await expect(appendCallNote(agent, id, 'nope')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('gives another outlet’s telecaller a 404, not a refusal', async () => {
      // A ForbiddenError here would itself confirm the order exists.
      const id = await newOrder()
      await expect(
        appendCallNote(otherTelecaller, id, 'not mine'),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(await logOf(telecaller, id)).toHaveLength(0)
    })

    it('treats a malformed id as a 404', async () => {
      await expect(appendCallNote(telecaller, 'not-an-id', 'x')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  describe('reading is open to roles that cannot write', () => {
    it('lets a store manager and a rider read the log', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Passenger asked for coach B2')

      expect((await logOf(manager, id)).map((n) => n.text)).toEqual(['Passenger asked for coach B2'])
      expect((await logOf(agent, id)).map((n) => n.text)).toEqual(['Passenger asked for coach B2'])
    })

    it('shows another outlet’s manager nothing at all', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Passenger asked for coach B2')
      expect(await findById(otherManager, id)).toBeNull()
    })
  })

  describe('status is irrelevant', () => {
    it('still takes a note after the order is cancelled', async () => {
      const id = await newOrder()
      await transitionOrder({
        ctx: telecaller,
        orderId: id,
        to: 'CANCELLED',
        meta: { reason: 'Passenger cancelled on the call' },
      })
      await appendCallNote(telecaller, id, 'Rang back, wants to reorder tomorrow')
      expect(await logOf(telecaller, id)).toHaveLength(1)
    })

    it('still takes a note after the order is delivered', async () => {
      const id = await newOrder()
      for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
        await transitionOrder({ ctx: manager, orderId: id, to })
      }
      await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })
      await transitionOrder({ ctx: agent, orderId: id, to: 'DELIVERED' })

      await appendCallNote(telecaller, id, 'Passenger complained the tea was cold')
      expect(await logOf(telecaller, id)).toHaveLength(1)
    })
  })

  it('keeps the newest notes and drops the oldest past the limit', async () => {
    const seeded = Array.from({ length: CALL_LOG_LIMIT }, (_, i) => ({
      text: `note ${i}`,
      userId: telecaller.userId,
      createdAt: new Date(),
    }))
    const id = await newOrder({ callLog: seeded })

    await appendCallNote(telecaller, id, 'the newest')

    const log = await logOf(telecaller, id)
    expect(log).toHaveLength(CALL_LOG_LIMIT)
    expect(log[0].text).toBe('note 1')
    expect(log.at(-1)!.text).toBe('the newest')
  })

  describe('editing and deleting', () => {
    async function noteOn(ctx: AuthContext, orderId: string) {
      return (await logOf(ctx, orderId))[0]
    }

    it('lets the author correct their own note, and stamps it edited', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Coach B4')
      const note = await noteOn(telecaller, id)
      expect(note.editedAt).toBeNull()

      await editCallNote(telecaller, id, String(note._id), 'Coach B2, they moved seats')

      const after = await noteOn(telecaller, id)
      expect(after.text).toBe('Coach B2, they moved seats')
      expect(after.editedAt).toBeInstanceOf(Date)
      expect(String(after._id)).toBe(String(note._id))
    })

    it('lets an admin correct somebody else’s note', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Original')
      const note = await noteOn(telecaller, id)

      await editCallNote(admin, id, String(note._id), 'Corrected by the admin')
      expect((await noteOn(telecaller, id)).text).toBe('Corrected by the admin')
    })

    it('refuses to let one telecaller rewrite another’s note', async () => {
      // Same outlet, so the scope check passes and authorship is the only
      // thing standing here.
      const sameOutletPeer = ctxFor(await makeUser('TELECALLER', '9100000007', ganga))
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Mine')
      const note = await noteOn(telecaller, id)

      await expect(
        editCallNote(sameOutletPeer, id, String(note._id), 'Not yours'),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        deleteCallNote(sameOutletPeer, id, String(note._id)),
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect((await noteOn(telecaller, id)).text).toBe('Mine')
    })

    it('refuses a store manager and a rider outright', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Mine')
      const note = await noteOn(telecaller, id)

      await expect(editCallNote(manager, id, String(note._id), 'x')).rejects.toBeInstanceOf(
        ForbiddenError,
      )
      await expect(deleteCallNote(agent, id, String(note._id))).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })

    it('gives another outlet’s telecaller a 404, not a refusal', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Mine')
      const note = await noteOn(telecaller, id)

      await expect(
        editCallNote(otherTelecaller, id, String(note._id), 'x'),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('deletes only the note asked for', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'first')
      await appendCallNote(telecaller, id, 'second')
      await appendCallNote(telecaller, id, 'third')
      const log = await logOf(telecaller, id)

      await deleteCallNote(telecaller, id, String(log[1]._id))

      expect((await logOf(telecaller, id)).map((n) => n.text)).toEqual(['first', 'third'])
    })

    it('refuses an empty or over-long correction, leaving the note as it was', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Keep me')
      const note = await noteOn(telecaller, id)

      await expect(editCallNote(telecaller, id, String(note._id), '   ')).rejects.toThrow()
      await expect(
        editCallNote(telecaller, id, String(note._id), 'x'.repeat(CALL_NOTE_MAX + 1)),
      ).rejects.toThrow()
      expect((await noteOn(telecaller, id)).text).toBe('Keep me')
    })

    it('treats a missing note as a 404', async () => {
      const id = await newOrder()
      const absent = String(new mongoose.Types.ObjectId())
      await expect(editCallNote(telecaller, id, absent, 'x')).rejects.toBeInstanceOf(NotFoundError)
      await expect(deleteCallNote(telecaller, id, absent)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('the view a screen gets', () => {
    it('marks a note manageable by its author and by an admin, and by nobody else', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Written by the desk')

      expect((await listCallNotes(telecaller, id))[0].canManage).toBe(true)
      expect((await listCallNotes(admin, id))[0].canManage).toBe(true)
      expect((await listCallNotes(manager, id))[0].canManage).toBe(false)
      expect((await listCallNotes(agent, id))[0].canManage).toBe(false)
    })

    it('names the author with their role, and reports an edit', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Before')
      const note = (await logOf(telecaller, id))[0]

      const before = (await listCallNotes(manager, id))[0]
      expect(before.author).toBe('TELECALLER 9100000002 · Telecaller')
      expect(before.editedAt).toBeNull()

      await editCallNote(telecaller, id, String(note._id), 'After')
      expect((await listCallNotes(manager, id))[0].editedAt).not.toBeNull()
    })
  })

  describe('the fields it must not touch', () => {
    it('leaves remark, notes and the event log alone', async () => {
      const id = await newOrder({ remark: 'Less spicy', notes: 'Gate 3 handover' })
      const before = await findById(telecaller, id)

      await appendCallNote(telecaller, id, 'Passenger asked for coach B2')

      const after = await findById(telecaller, id)
      expect(after!.remark).toBe('Less spicy')
      expect(after!.notes).toBe('Gate 3 handover')
      expect(after!.events).toHaveLength(before!.events.length)
    })

    it('cannot be replaced through the general field updater', async () => {
      const id = await newOrder()
      await appendCallNote(telecaller, id, 'Passenger asked for coach B2')

      await expect(updateOrderFields(admin, id, { callLog: [] })).rejects.toThrow()
      expect(await logOf(telecaller, id)).toHaveLength(1)
    })
  })
})
