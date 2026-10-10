import mongoose from 'mongoose'
import { Order, Restaurant, type OrderDoc } from '../models'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../authContext'
import { istLocalToUtc, rupeesToPaise } from '../format'
import {
  ITEM_EDIT_FIELDS,
  ORDER_EDIT_FIELDS,
  type EditableField,
  type ItemEditKey,
} from '../orderEditFields'
import { scoped } from './orderRepo'

/**
 * An admin correcting any detail of an order, with every change written to
 * the event log: who, when, which field, the old value and the new one.
 *
 * Each changed field is its own side-effect event (status unchanged, the same
 * shape assignAgents and the cancel requests write), so the log reads one
 * correction per line next to the accepts, KOT sends and payments. Nothing is
 * written, and nothing logged, for a field whose value did not change.
 *
 * The read and the write share a transaction, so the "old" value logged is the
 * value the write replaced, not one another admin had already overwritten.
 */

export const FIELD_EDITED = 'FIELD_EDITED'
export const ITEM_EDITED = 'ITEM_EDITED'
export const ITEM_ADDED = 'ITEM_ADDED'
export const ITEM_REMOVED = 'ITEM_REMOVED'

/** Raw form input: a string per field, '' meaning "clear it". */
export type FieldInput = Record<string, string>

/** A bad value, phrased for the person who typed it. */
export class FieldValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FieldValidationError'
  }
}

/** Turns one form string into the value stored for that field. */
function parseValue(field: EditableField, raw: string): unknown {
  const text = raw.trim()
  if (!text) {
    if (field.required) throw new FieldValidationError(`${field.label} cannot be empty.`)
    return null
  }
  if (field.max && text.length > field.max) {
    throw new FieldValidationError(`Keep ${field.label.toLowerCase()} under ${field.max} characters.`)
  }

  switch (field.kind) {
    case 'text':
    case 'longtext':
      return field.key === 'stationCode' ? text.toUpperCase() : text
    case 'enum':
      if (!field.options?.includes(text)) throw new FieldValidationError(`Pick a valid ${field.label.toLowerCase()}.`)
      return field.key === 'isPacking' ? text === 'true' : text
    case 'money': {
      const paise = rupeesToPaise(text)
      if (paise === null) throw new FieldValidationError(`${field.label} must be a positive amount in rupees.`)
      return paise
    }
    case 'int': {
      const n = Number(text)
      if (!Number.isInteger(n) || n < 1) throw new FieldValidationError(`${field.label} must be a whole number of at least 1.`)
      return n
    }
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
        throw new FieldValidationError(`${field.label} must be a date.`)
      }
      return text
    case 'datetime': {
      const d = istLocalToUtc(text)
      if (!d) throw new FieldValidationError(`${field.label} must be a date and time.`)
      return d
    }
    case 'outlet':
      if (!mongoose.isValidObjectId(text)) throw new FieldValidationError('Pick an outlet from the list.')
      return new mongoose.Types.ObjectId(text)
  }
}

/** Stored values compared by what they mean, not by reference. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v === undefined || v === null || v === '') return null
    if (v instanceof Date) return v.getTime()
    if (v instanceof mongoose.Types.ObjectId) return String(v)
    return v
  }
  return norm(a) === norm(b)
}

/** What a value is written to the log as. Dates as ISO, ids never alone. */
function loggable(v: unknown): unknown {
  if (v === undefined || v === '') return null
  if (v instanceof Date) return v.toISOString()
  if (v instanceof mongoose.Types.ObjectId) return String(v)
  return v
}

function sideEvent(ctx: AuthContext, status: string, meta: Record<string, unknown>, at: Date) {
  return { fromStatus: status, toStatus: status, userId: ctx.userId, meta: { ...meta, via: 'admin-detail' }, createdAt: at }
}

function requireAdmin(ctx: AuthContext) {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may edit an order’s details.')
}

function isDuplicateKey(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === 11000)
}

async function inTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession()
  try {
    let out: T
    await session.withTransaction(async () => {
      out = await fn(session)
    })
    return out!
  } finally {
    await session.endSession()
  }
}

export type FieldChange = { field: string; label: string; from: unknown; to: unknown }

/**
 * Applies the fields in `input` that differ from what is stored, and logs one
 * event per field changed. Keys that are not editable are refused outright
 * rather than ignored, so a typo in a caller is loud.
 *
 * Returns the changes made; an empty list means nothing differed.
 */
export async function adminEditOrder(
  ctx: AuthContext,
  orderId: string,
  input: FieldInput,
): Promise<FieldChange[]> {
  requireAdmin(ctx)
  if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found')

  const defs = new Map<string, EditableField>(ORDER_EDIT_FIELDS.map((f) => [f.key, f]))
  const parsed: [EditableField, unknown][] = []
  for (const [key, raw] of Object.entries(input)) {
    const def = defs.get(key)
    if (!def) throw new FieldValidationError(`${key} cannot be edited here.`)
    parsed.push([def, parseValue(def, raw)])
  }
  if (parsed.length === 0) return []

  // Outlets are logged by name: an id in an audit trail sends the reader off
  // to look it up, and the outlet may since have been renamed or deleted.
  const outletIds = parsed
    .filter(([d]) => d.kind === 'outlet')
    .map(([, v]) => v)
    .filter((v): v is mongoose.Types.ObjectId => v instanceof mongoose.Types.ObjectId)
  const _id = new mongoose.Types.ObjectId(orderId)

  try {
    return await inTransaction(async (session) => {
      const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
      if (!current) throw new NotFoundError('Order not found')
      const row = current as unknown as Record<string, unknown>

      const changes = parsed.filter(([def, value]) => !sameValue(row[def.key], value))
      if (changes.length === 0) return []

      // The unique index is the real guard (the catch below); this is the same
      // check made first, so a database built without it still refuses.
      const newId = changes.find(([d]) => d.key === 'externalOrderId')?.[1]
      if (newId && (await Order.exists({ externalOrderId: newId, _id: { $ne: _id } }).session(session))) {
        throw new ConflictError('Another order already has that order id.')
      }

      const outletNames = new Map<string, string>()
      if (changes.some(([d]) => d.kind === 'outlet')) {
        // Both ends: the outlet it moved from is named in the log as well.
        const outletLookups = current.restaurantId ? [...outletIds, current.restaurantId] : outletIds
        const found = await Restaurant.find({ _id: { $in: outletLookups } }, 'name stationCode', { session }).lean()
        for (const r of found) outletNames.set(String(r._id), `${r.name} · ${r.stationCode}`)
        for (const id of outletIds) {
          if (!outletNames.has(String(id))) throw new FieldValidationError('That outlet no longer exists.')
        }
      }
      const display = (def: EditableField, v: unknown) =>
        def.kind === 'outlet' && v ? (outletNames.get(String(v)) ?? String(v)) : loggable(v)

      const now = new Date()
      const $set: Record<string, unknown> = {}
      const events = changes.map(([def, value]) => {
        $set[def.key] = value
        return sideEvent(
          ctx,
          current.status,
          { action: FIELD_EDITED, field: def.key, label: def.label, from: display(def, row[def.key]), to: display(def, value) },
          now,
        )
      })

      const res = await Order.updateOne(
        { _id, status: current.status },
        { $set, $push: { events: { $each: events } } },
        { session, runValidators: true },
      )
      if (res.matchedCount === 0) throw new ConflictError('This order changed underneath you. Reload and try again.')

      return changes.map(([def, value]) => ({
        field: def.key, label: def.label, from: display(def, row[def.key]), to: display(def, value),
      }))
    })
  } catch (err) {
    if (isDuplicateKey(err)) throw new ConflictError('Another order already has that order id.')
    throw err
  }
}

type ItemRow = {
  _id: mongoose.Types.ObjectId
  name: string
  qty: number
  pricePaise?: number | null
  notes?: string | null
  spec?: string | null
  isPacking?: boolean | null
}

/** Edits one item, logging one event per field of it that changed. */
export async function adminEditOrderItem(
  ctx: AuthContext,
  orderId: string,
  itemId: string,
  input: Partial<Record<ItemEditKey, string>>,
): Promise<FieldChange[]> {
  requireAdmin(ctx)
  if (!mongoose.isValidObjectId(orderId) || !mongoose.isValidObjectId(itemId)) {
    throw new NotFoundError('Item not found')
  }
  const defs = new Map<string, EditableField>(ITEM_EDIT_FIELDS.map((f) => [f.key, f]))
  const parsed: [EditableField, unknown][] = []
  for (const [key, raw] of Object.entries(input)) {
    const def = defs.get(key)
    if (!def) throw new FieldValidationError(`${key} cannot be edited here.`)
    parsed.push([def, parseValue(def, raw ?? '')])
  }

  const _id = new mongoose.Types.ObjectId(orderId)
  const iid = new mongoose.Types.ObjectId(itemId)

  return inTransaction(async (session) => {
    const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
    if (!current) throw new NotFoundError('Order not found')
    const item = (current.items as ItemRow[]).find((i) => i._id.equals(iid))
    if (!item) throw new NotFoundError('Item not found')
    const row = item as unknown as Record<string, unknown>

    const changes = parsed.filter(([def, value]) => {
      // isPacking is absent on old rows and means false there.
      const was = def.key === 'isPacking' ? Boolean(row.isPacking) : row[def.key]
      return !sameValue(was, value)
    })
    if (changes.length === 0) return []

    const now = new Date()
    const newName = (changes.find(([d]) => d.key === 'name')?.[1] as string | undefined) ?? item.name
    const $set: Record<string, unknown> = {}
    const out: FieldChange[] = []
    const events = changes.map(([def, value]) => {
      $set[`items.$.${def.key}`] = value
      const from = loggable(def.key === 'isPacking' ? Boolean(row.isPacking) : row[def.key])
      const to = loggable(value)
      out.push({ field: def.key, label: def.label, from, to })
      return sideEvent(
        ctx,
        current.status,
        { action: ITEM_EDITED, itemId, item: newName, field: def.key, label: def.label, from, to },
        now,
      )
    })

    const res = await Order.updateOne(
      { _id, status: current.status, 'items._id': iid },
      { $set, $push: { events: { $each: events } } },
      { session, runValidators: true },
    )
    if (res.matchedCount === 0) throw new ConflictError('This order changed underneath you. Reload and try again.')
    return out
  })
}

/** What an added or removed item is logged as. */
function itemSummary(i: { name: string; qty: number; pricePaise?: number | null; isPacking?: boolean | null }) {
  return { item: i.name, qty: i.qty, pricePaise: i.pricePaise ?? null, isPacking: Boolean(i.isPacking) }
}

export async function adminAddOrderItem(
  ctx: AuthContext,
  orderId: string,
  input: Partial<Record<ItemEditKey, string>>,
): Promise<void> {
  requireAdmin(ctx)
  if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found')
  const doc: Record<string, unknown> = { isPacking: false, notes: null, spec: null, pricePaise: null }
  for (const def of ITEM_EDIT_FIELDS) {
    const raw = input[def.key]
    if (raw === undefined) {
      if ('required' in def && def.required) throw new FieldValidationError(`${def.label} cannot be empty.`)
      continue
    }
    doc[def.key] = parseValue(def, raw)
  }
  const _id = new mongoose.Types.ObjectId(orderId)
  const itemId = new mongoose.Types.ObjectId()

  await inTransaction(async (session) => {
    const current = await Order.findOne(scoped(ctx, { _id }), 'status', { session }).lean<OrderDoc>()
    if (!current) throw new NotFoundError('Order not found')
    const res = await Order.updateOne(
      { _id, status: current.status },
      {
        $push: {
          items: { _id: itemId, ...doc },
          events: sideEvent(
            ctx,
            current.status,
            { action: ITEM_ADDED, itemId: String(itemId), ...itemSummary(doc as ItemRow) },
            new Date(),
          ),
        },
      },
      { session, runValidators: true },
    )
    if (res.matchedCount === 0) throw new ConflictError('This order changed underneath you. Reload and try again.')
  })
}

export async function adminRemoveOrderItem(ctx: AuthContext, orderId: string, itemId: string): Promise<void> {
  requireAdmin(ctx)
  if (!mongoose.isValidObjectId(orderId) || !mongoose.isValidObjectId(itemId)) {
    throw new NotFoundError('Item not found')
  }
  const _id = new mongoose.Types.ObjectId(orderId)
  const iid = new mongoose.Types.ObjectId(itemId)

  await inTransaction(async (session) => {
    const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
    if (!current) throw new NotFoundError('Order not found')
    const item = (current.items as ItemRow[]).find((i) => i._id.equals(iid))
    if (!item) throw new NotFoundError('Item not found')

    const res = await Order.updateOne(
      { _id, status: current.status, 'items._id': iid },
      {
        $pull: { items: { _id: iid } },
        $push: {
          events: sideEvent(
            ctx,
            current.status,
            { action: ITEM_REMOVED, itemId, ...itemSummary(item) },
            new Date(),
          ),
        },
      },
      { session },
    )
    if (res.matchedCount === 0) throw new ConflictError('This order changed underneath you. Reload and try again.')
  })
}
