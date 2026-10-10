/**
 * The order fields an admin may correct from /admin/orders/[id], and how each
 * one reads in the event log.
 *
 * No Mongoose import, for the same reason as orderEnums.ts: the edit form and
 * the EventLog both run this, and the form is a client component.
 *
 * Deliberately absent: `status` (transitionOrder and adminOverrideStatus own
 * it), `events` and `callLog` (logs, not details), `kotNote` (setKotNote owns
 * it and logs its own change), `items` (edited one at a time, see
 * ITEM_FIELDS), and `delivery` (what the rider recorded at the door).
 */
import { ORDER_SOURCES, ORDER_TYPES, PAYMENT_MODES, sourceLabel } from './orderEnums'
import { formatIST, formatMoney, formatServiceDate } from './format'

export type FieldKind =
  | 'text'
  | 'longtext'
  | 'enum'
  | 'money'
  | 'datetime'
  | 'date'
  | 'int'
  | 'outlet'

export type EditableField = {
  key: string
  label: string
  kind: FieldKind
  /** Cannot be cleared to empty. */
  required?: boolean
  options?: readonly string[]
  max?: number
}

export const ORDER_EDIT_FIELDS = [
  { key: 'externalOrderId', label: 'Order id', kind: 'text', required: true, max: 100 },
  { key: 'source', label: 'Source', kind: 'enum', required: true, options: ORDER_SOURCES },
  { key: 'orderType', label: 'Order type', kind: 'enum', required: true, options: ORDER_TYPES },
  { key: 'restaurantId', label: 'Outlet', kind: 'outlet' },
  { key: 'stationCode', label: 'Station', kind: 'text', required: true, max: 10 },
  { key: 'serviceDate', label: 'Service date', kind: 'date', required: true },
  { key: 'trainNo', label: 'Train number', kind: 'text', max: 20 },
  { key: 'trainName', label: 'Train name', kind: 'text', max: 100 },
  { key: 'scheduledArrival', label: 'Scheduled arrival', kind: 'datetime' },
  { key: 'coach', label: 'Coach', kind: 'text', max: 20 },
  { key: 'berth', label: 'Berth', kind: 'text', max: 20 },
  { key: 'rawSeat', label: 'Seat', kind: 'text', max: 50 },
  { key: 'contactName', label: 'Contact name', kind: 'text', max: 100 },
  { key: 'contactPhone', label: 'Contact phone', kind: 'text', max: 30 },
  { key: 'pax', label: 'Pax', kind: 'int' },
  { key: 'handoverPoint', label: 'Handover point', kind: 'text', max: 200 },
  { key: 'readyBy', label: 'Ready by', kind: 'datetime' },
  { key: 'amountPaise', label: 'Amount', kind: 'money' },
  { key: 'paymentMode', label: 'Payment mode', kind: 'enum', options: PAYMENT_MODES },
  { key: 'notes', label: 'Notes', kind: 'longtext', max: 2000 },
  { key: 'remark', label: 'Remark for the kitchen', kind: 'longtext', max: 500 },
] as const satisfies readonly EditableField[]

export type OrderEditKey = (typeof ORDER_EDIT_FIELDS)[number]['key']

/** Per-item fields, edited through the pencil on each item row. */
export const ITEM_EDIT_FIELDS = [
  { key: 'name', label: 'Name', kind: 'text', required: true, max: 200 },
  { key: 'qty', label: 'Qty', kind: 'int', required: true },
  { key: 'pricePaise', label: 'Price', kind: 'money' },
  { key: 'notes', label: 'Notes', kind: 'longtext', max: 500 },
  { key: 'spec', label: 'Spec', kind: 'longtext', max: 2000 },
  { key: 'isPacking', label: 'Packing item', kind: 'enum', options: ['true', 'false'] },
] as const satisfies readonly EditableField[]

export type ItemEditKey = (typeof ITEM_EDIT_FIELDS)[number]['key']

/** Also the kot note, which setKotNote logs under the same action. */
const LOG_ONLY_FIELDS: EditableField[] = [{ key: 'kotNote', label: 'KOT note', kind: 'longtext' }]

const BY_KEY = new Map<string, EditableField>(
  [...ORDER_EDIT_FIELDS, ...LOG_ONLY_FIELDS].map((f) => [f.key, f]),
)
const ITEM_BY_KEY = new Map<string, EditableField>(ITEM_EDIT_FIELDS.map((f) => [f.key, f]))

export function orderField(key: string): EditableField | undefined {
  return BY_KEY.get(key)
}

export function itemField(key: string): EditableField | undefined {
  return ITEM_BY_KEY.get(key)
}

export function enumOptionLabel(key: string, value: string): string {
  if (key === 'source') return sourceLabel(value)
  if (key === 'paymentMode') return value === 'COD' ? 'COD' : value.charAt(0) + value.slice(1).toLowerCase()
  if (key === 'orderType') return value.charAt(0) + value.slice(1).toLowerCase()
  if (key === 'isPacking') return value === 'true' ? 'Yes' : 'No'
  return value
}

/**
 * One logged value, as a person reads it. Outlets are logged by name at write
 * time (an id means nothing in a log), so they arrive here as text already.
 */
export function formatLoggedValue(field: EditableField | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty'
  switch (field?.kind) {
    case 'money':
      return typeof value === 'number' ? formatMoney(value) : String(value)
    case 'datetime':
      return formatIST(value as string | Date)
    case 'date':
      return typeof value === 'string' ? formatServiceDate(value) : String(value)
    case 'enum':
      return enumOptionLabel(field.key, String(value))
    default:
      return String(value)
  }
}
