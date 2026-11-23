/**
 * Email layouts an admin teaches by highlighting, with no regex and no AI.
 *
 * A rule never stores screen positions. It stores the words printed in front
 * of a value ("Customer Name :") and where the value stops (end of line, a
 * tab, or the next words), so it keeps working when a name is longer or a
 * line moves. Every anchor is plain text, matched case-insensitively with any
 * run of spaces treated as one; nothing an admin types is ever compiled into
 * a regular expression (a crafted pattern could hang the server).
 *
 * Pure types, shared by the builder screen (live preview in the browser) and
 * the ingestion (server).
 */

export const TEMPLATE_FIELDS = [
  'externalOrderId',
  'contactName',
  'contactPhone',
  'trainNo',
  'trainName',
  'seat',
  'stationCode',
  'outletName',
  'arrival',
  'amount',
  'paymentMode',
] as const
export type TemplateField = (typeof TEMPLATE_FIELDS)[number]

/** How each field is named on the builder screen. Plain words, not jargon. */
export const FIELD_LABEL: Record<TemplateField, string> = {
  externalOrderId: 'Order number',
  contactName: 'Passenger name',
  contactPhone: 'Phone',
  trainNo: 'Train number',
  trainName: 'Train name',
  seat: 'Coach and seat',
  stationCode: 'Station',
  outletName: 'Kitchen / outlet name',
  arrival: 'Arrival or delivery time',
  amount: 'Order total',
  paymentMode: 'Paid online or cash',
}

/** Fields without which no order is created. Dishes are required too. */
export const REQUIRED_FIELDS: readonly TemplateField[] = ['externalOrderId']

/** Where a value ends, after its anchor. */
export type StopRule =
  | { kind: 'eol' }
  | { kind: 'tab' }
  /** Plain text that follows the value on the same line ("Phone", " /"). */
  | { kind: 'text'; text: string }

export type FieldRule = {
  field: TemplateField
  /**
   * The plain text in front of the value. With `nextLine`, the whole line
   * above the value (for "Customer Name" on one line, "Ram" on the next).
   */
  anchor: string
  /** Which occurrence of the anchor, from 0, when the same words repeat. */
  nth: number
  where: 'sameLine' | 'nextLine'
  stop: StopRule
  /** What it read in the sample, shown on the builder. */
  sample?: string
}

/**
 * One dish row, learned from one example. Either cells split by a
 * delimiter (a table), or a shape of fixed words around the name and the
 * quantity ("1 x PANEER CURRY (Veg),").
 */
export type RowShape =
  | {
      kind: 'cells'
      delimiter: 'tab' | 'pipe' | 'spaces'
      nameCol: number
      qtyCol: number | null
      /** The same quantity column counted from the right, for rows with a blank cell. */
      qtyFromEnd: number | null
      minCols: number
    }
  /**
   * The name alone on its line and the quantity a few lines below it (a
   * description in between, or one value per line): "Special Egg Thali" /
   * "Egg Curry, Daal …    239    1    239".
   */
  | { kind: 'stacked'; qtyOffset: number; qtyFromEnd: number }
  | {
      kind: 'pattern'
      /** In order. `literal` pieces must appear; `name` and `qty` are read. */
      parts: ({ kind: 'literal'; text: string } | { kind: 'name' } | { kind: 'qty' })[]
      /** Several dishes on one line, split on this ("A - 1 | B - 2"). */
      unitSeparator: '|' | ';' | '#' | null
    }

export type ItemsRule = {
  /** The nearest non-empty line above the first dish (a header, often). */
  startAnchor: string
  startNth: number
  /** The first dish is on the heading's own line ("Items<tab>2 x Thali"). */
  startSameLine: boolean
  /** Dishes stop before the first line starting with this, when set. */
  endAnchor: string | null
  shape: RowShape
  sample?: string
}

export type DateOrder = 'DMY' | 'MDY' | 'YMD'

export type TemplateRules = {
  fields: FieldRule[]
  items: ItemsRule | null
  /** Fixed values for mail that never prints them. */
  fixed: { outletName: string | null; stationCode: string | null; paymentMode: 'PREPAID' | 'COD' | null }
  /** How numeric dates read: 05/09/2026 is 5 Sep (DMY) or 9 May (MDY). */
  dateOrder: DateOrder
}

export const EMPTY_RULES: TemplateRules = {
  fields: [],
  items: null,
  fixed: { outletName: null, stationCode: null, paymentMode: null },
  dateOrder: 'DMY',
}

/** Hard caps, checked when a template is saved and again when it runs. */
export const LIMITS = {
  anchor: 120,
  stopText: 40,
  body: 60_000,
  line: 600,
  items: 80,
  fields: TEMPLATE_FIELDS.length,
  patternParts: 9,
} as const
