import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { findById, setKotNote } from '../src/lib/repo/orderRepo'
import { assignAgents, transitionOrder } from '../src/lib/repo/transitionOrder'
import {
  adminAddOrderItem,
  adminEditOrder,
  adminEditOrderItem,
  adminRemoveOrderItem,
  FieldValidationError,
} from '../src/lib/repo/adminEditOrder'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * An admin correcting any detail of an order from its full page, and the event
 * log carrying each correction — who, when, the old value and the new one —
 * beside the accepts and KOT sends it already held.
 */
describe('admin order edits', () => {
  let admin: AuthContext
  let telecaller: AuthContext
  let manager: AuthContext
  let ganga: mongoose.Types.ObjectId
  let annapurna: mongoose.Types.ObjectId
  let riderA: mongoose.Types.ObjectId
  let riderB: mongoose.Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    ganga = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    annapurna = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id
    admin = ctxFor(await makeUser('ADMIN', '9300000001'))
    telecaller = ctxFor(await makeUser('TELECALLER', '9300000002', ganga))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9300000003', ganga))
    riderA = (await makeUser('DELIVERY_AGENT', '9300000004', ganga))._id
    riderB = (await makeUser('DELIVERY_AGENT', '9300000005', ganga))._id
  })

  afterAll(async () => {
    await disconnectDb()
  })

  async function newOrder(overrides: Record<string, unknown> = {}) {
    const o = await makeOrder({ restaurantId: ganga, stationCode: 'CNB', ...overrides })
    return String(o._id)
  }

  const load = async (id: string) => (await findById(admin, id))!
  const edits = async (id: string) =>
    (await load(id)).events.filter((e) => (e.meta as Record<string, unknown>)?.action !== 'CREATED')

  describe('order fields', () => {
    it('changes a field and logs who, the old value and the new one', async () => {
      const id = await newOrder({ paymentMode: 'COD' })
      const before = new Date()

      const changes = await adminEditOrder(admin, id, { paymentMode: 'PREPAID' })

      expect(changes).toEqual([{ field: 'paymentMode', label: 'Payment mode', from: 'COD', to: 'PREPAID' }])
      const order = await load(id)
      expect(order.paymentMode).toBe('PREPAID')
      const [e] = await edits(id)
      expect(e.fromStatus).toBe('RECEIVED')
      expect(e.toStatus).toBe('RECEIVED')
      expect(String(e.userId)).toBe(String(admin.userId))
      expect(e.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
      expect(e.meta).toMatchObject({
        action: 'FIELD_EDITED', field: 'paymentMode', from: 'COD', to: 'PREPAID', via: 'admin-detail',
      })
    })

    it('logs one event per changed field, and none for a field left as it was', async () => {
      const id = await newOrder({ trainNo: '12301', contactName: 'Ravi' })

      await adminEditOrder(admin, id, {
        trainNo: '12302',
        contactName: 'Ravi',
        coach: 'B2',
        amountPaise: '250.50',
      })

      const order = await load(id)
      expect(order.trainNo).toBe('12302')
      expect(order.coach).toBe('B2')
      expect(order.amountPaise).toBe(25050)
      const logged = (await edits(id)).map((e) => e.meta as Record<string, unknown>)
      expect(logged.map((m) => m.field).sort()).toEqual(['amountPaise', 'coach', 'trainNo'])
      expect(logged.find((m) => m.field === 'amountPaise')).toMatchObject({ from: 12000, to: 25050 })
      expect(logged.find((m) => m.field === 'coach')).toMatchObject({ from: null, to: 'B2' })
    })

    it('writes nothing and logs nothing when nothing differs', async () => {
      const id = await newOrder()
      const changes = await adminEditOrder(admin, id, { paymentMode: 'COD', contactName: '  Test Passenger ' })
      expect(changes).toEqual([])
      expect(await edits(id)).toHaveLength(0)
    })

    it('clears an optional field on an empty string', async () => {
      const id = await newOrder({ remark: 'Less spicy' })
      await adminEditOrder(admin, id, { remark: '' })
      expect((await load(id)).remark).toBeNull()
      expect((await edits(id))[0].meta).toMatchObject({ field: 'remark', from: 'Less spicy', to: null })
    })

    it('reads times as IST and logs them as instants', async () => {
      const id = await newOrder()
      await adminEditOrder(admin, id, { scheduledArrival: '2026-08-27T13:25' })
      const order = await load(id)
      expect(order.scheduledArrival!.toISOString()).toBe('2026-08-27T07:55:00.000Z')
      expect((await edits(id))[0].meta).toMatchObject({ from: null, to: '2026-08-27T07:55:00.000Z' })
    })

    it('moves the order to another outlet and logs both outlets by name', async () => {
      const id = await newOrder()
      await adminEditOrder(admin, id, { restaurantId: String(annapurna), stationCode: 'pryj' })
      const order = await load(id)
      expect(String(order.restaurantId)).toBe(String(annapurna))
      expect(order.stationCode).toBe('PRYJ')
      const outletEvent = (await edits(id)).find((e) => (e.meta as Record<string, unknown>).field === 'restaurantId')
      expect(outletEvent!.meta).toMatchObject({
        from: 'HOTEL GANGA GALAXY · CNB',
        to: 'SHREE ANNAPURNA · PRYJ',
      })
    })

    it('changes the order id, and refuses one another order already has', async () => {
      const id = await newOrder({ externalOrderId: 'EDIT-ME-1' })
      await newOrder({ externalOrderId: 'TAKEN-1' })

      await adminEditOrder(admin, id, { externalOrderId: 'EDIT-ME-2' })
      expect((await load(id)).externalOrderId).toBe('EDIT-ME-2')

      await expect(adminEditOrder(admin, id, { externalOrderId: 'TAKEN-1' })).rejects.toBeInstanceOf(ConflictError)
      expect((await load(id)).externalOrderId).toBe('EDIT-ME-2')
      // The refused change left no trace in the log.
      expect((await edits(id)).map((e) => (e.meta as Record<string, unknown>).to)).toEqual(['EDIT-ME-2'])
    })

    it('covers every detail: type, source, service date, seat, pax, ready-by, notes', async () => {
      const id = await newOrder()
      await adminEditOrder(admin, id, {
        orderType: 'BULK',
        source: 'ZOOP',
        serviceDate: '2026-08-28',
        trainName: 'Shatabdi',
        berth: '32',
        rawSeat: 'B2-32',
        contactPhone: '9876543210',
        pax: '40',
        handoverPoint: 'Gate 3',
        readyBy: '2026-08-28T12:00',
        notes: 'Call on arrival',
      })
      const o = await load(id)
      expect(o.orderType).toBe('BULK')
      expect(o.source).toBe('ZOOP')
      expect(o.serviceDate).toBe('2026-08-28')
      expect(o.pax).toBe(40)
      expect(o.notes).toBe('Call on arrival')
      expect(await edits(id)).toHaveLength(11)
    })

    it('refuses bad values with a message, writing nothing', async () => {
      const id = await newOrder()
      const bad: Record<string, string>[] = [
        { paymentMode: 'BARTER' },
        { amountPaise: '-5' },
        { amountPaise: 'lots' },
        { pax: '0' },
        { serviceDate: '28/08/2026' },
        { scheduledArrival: 'soon' },
        { externalOrderId: '  ' },
        { restaurantId: 'not-an-id' },
        { restaurantId: String(new mongoose.Types.ObjectId()) },
        { status: 'DELIVERED' },
        { events: '[]' },
        { remark: 'x'.repeat(501) },
      ]
      for (const input of bad) {
        await expect(adminEditOrder(admin, id, input), JSON.stringify(input).slice(0, 60)).rejects.toBeInstanceOf(
          FieldValidationError,
        )
      }
      expect(await edits(id)).toHaveLength(0)
    })

    it('is admin-only', async () => {
      const id = await newOrder()
      for (const ctx of [telecaller, manager]) {
        await expect(adminEditOrder(ctx, id, { remark: 'hi' })).rejects.toBeInstanceOf(ForbiddenError)
      }
    })

    it('reports a missing order as not found', async () => {
      await expect(adminEditOrder(admin, String(new mongoose.Types.ObjectId()), { remark: 'x' })).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })

    it('sits in the same log as the status changes, in the order they happened', async () => {
      const id = await newOrder()
      await transitionOrder({ ctx: admin, orderId: id, to: 'ACCEPTED' })
      await adminEditOrder(admin, id, { paymentMode: 'PREPAID' })
      const events = (await load(id)).events
      expect(events.map((e) => [e.fromStatus, e.toStatus, (e.meta as Record<string, unknown>)?.action ?? null])).toEqual([
        [null, 'RECEIVED', 'CREATED'],
        ['RECEIVED', 'ACCEPTED', null],
        ['ACCEPTED', 'ACCEPTED', 'FIELD_EDITED'],
      ])
    })
  })

  describe('items', () => {
    it('edits an item and logs each changed field against the item', async () => {
      const id = await newOrder()
      const itemId = String((await load(id)).items[0]._id)

      await adminEditOrderItem(admin, id, itemId, {
        name: 'Veg Thali',
        qty: '3',
        pricePaise: '150',
        notes: 'No onion',
        spec: 'Dal, rice, 4 roti',
        isPacking: 'false',
      })

      const item = (await load(id)).items[0]
      expect(item.qty).toBe(3)
      expect(item.pricePaise).toBe(15000)
      expect(item.notes).toBe('No onion')
      expect(item.spec).toBe('Dal, rice, 4 roti')
      const logged = (await edits(id)).map((e) => e.meta as Record<string, unknown>)
      expect(logged.map((m) => m.field).sort()).toEqual(['notes', 'pricePaise', 'qty', 'spec'])
      expect(logged.find((m) => m.field === 'qty')).toMatchObject({
        action: 'ITEM_EDITED', item: 'Veg Thali', itemId, from: 1, to: 3,
      })
    })

    it('logs a rename under the new name, with the old one as its from', async () => {
      const id = await newOrder()
      const itemId = String((await load(id)).items[0]._id)
      await adminEditOrderItem(admin, id, itemId, { name: 'Deluxe Thali' })
      expect((await edits(id))[0].meta).toMatchObject({ item: 'Deluxe Thali', from: 'Veg Thali', to: 'Deluxe Thali' })
    })

    it('adds an item and logs it', async () => {
      const id = await newOrder()
      await adminAddOrderItem(admin, id, { name: 'Water bottle', qty: '2', pricePaise: '20', isPacking: 'true' })
      const items = (await load(id)).items
      expect(items).toHaveLength(2)
      expect(items[1]).toMatchObject({ name: 'Water bottle', qty: 2, pricePaise: 2000, isPacking: true })
      expect((await edits(id))[0].meta).toMatchObject({
        action: 'ITEM_ADDED', item: 'Water bottle', qty: 2, pricePaise: 2000, isPacking: true,
      })
    })

    it('removes an item and logs what it was', async () => {
      const id = await newOrder()
      const itemId = String((await load(id)).items[0]._id)
      await adminRemoveOrderItem(admin, id, itemId)
      expect((await load(id)).items).toHaveLength(0)
      expect((await edits(id))[0].meta).toMatchObject({
        action: 'ITEM_REMOVED', item: 'Veg Thali', qty: 1, pricePaise: 12000,
      })
    })

    it('refuses a bad quantity, an empty name and a missing item', async () => {
      const id = await newOrder()
      const itemId = String((await load(id)).items[0]._id)
      await expect(adminEditOrderItem(admin, id, itemId, { qty: '0' })).rejects.toBeInstanceOf(FieldValidationError)
      await expect(adminEditOrderItem(admin, id, itemId, { name: '' })).rejects.toBeInstanceOf(FieldValidationError)
      await expect(adminAddOrderItem(admin, id, { qty: '1' })).rejects.toBeInstanceOf(FieldValidationError)
      await expect(
        adminEditOrderItem(admin, id, String(new mongoose.Types.ObjectId()), { qty: '2' }),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(await edits(id)).toHaveLength(0)
    })

    it('is admin-only', async () => {
      const id = await newOrder()
      const itemId = String((await load(id)).items[0]._id)
      await expect(adminEditOrderItem(telecaller, id, itemId, { qty: '2' })).rejects.toBeInstanceOf(ForbiddenError)
      await expect(adminAddOrderItem(manager, id, { name: 'x', qty: '1' })).rejects.toBeInstanceOf(ForbiddenError)
      await expect(adminRemoveOrderItem(telecaller, id, itemId)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe('the other corrections on the page', () => {
    it('logs a KOT note change with its old and new text, and not a save that changed nothing', async () => {
      const id = await newOrder()
      await setKotNote(admin, id, 'Call first')
      await setKotNote(admin, id, 'Call first')
      await setKotNote(admin, id, 'Call twice')
      const logged = (await edits(id)).map((e) => e.meta as Record<string, unknown>)
      expect(logged).toEqual([
        { action: 'FIELD_EDITED', field: 'kotNote', label: 'KOT note', from: null, to: 'Call first' },
        { action: 'FIELD_EDITED', field: 'kotNote', label: 'KOT note', from: 'Call first', to: 'Call twice' },
      ])
    })

    it('logs who had the order before a rider correction', async () => {
      const id = await newOrder()
      await assignAgents({ ctx: admin, orderId: id, agentIds: [String(riderA)] })
      await assignAgents({ ctx: admin, orderId: id, agentIds: [String(riderB)] })
      const logged = (await edits(id)).map((e) => e.meta as Record<string, unknown>)
      expect(logged[0]).toMatchObject({ fromAgentIds: [], agentIds: [String(riderA)] })
      expect(logged[1]).toMatchObject({ fromAgentIds: [String(riderA)], agentIds: [String(riderB)] })
    })
  })
})
