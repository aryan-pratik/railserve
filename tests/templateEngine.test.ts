import { describe, expect, it } from 'vitest'
import { learnField, learnItems, normaliseBody, readField, readItems, runTemplate, validateRules, findText } from '../src/lib/ingest/templates/engine'
import { readOrderId } from '../src/lib/ingest/templates/values'
import type { FieldRule, ItemsRule, TemplateRules } from '../src/lib/ingest/templates/types'
import type { OrderParser } from '../src/lib/ingest/types'
import { ZoopParser } from '../src/lib/ingest/parsers/zoop'
import { RajBhogParser } from '../src/lib/ingest/parsers/rajbhog'
import { RailRestroParser } from '../src/lib/ingest/parsers/railrestro'
import { HomeBytesParser } from '../src/lib/ingest/parsers/homebytes'
import { BrotherByteParser } from '../src/lib/ingest/parsers/brotherbyte'
import { FoodOnTrainsParser } from '../src/lib/ingest/parsers/foodontrains'
import { OrderNotificationParser } from '../src/lib/ingest/parsers/orderNotification'
import { YatribhojanParser } from '../src/lib/ingest/parsers/yatribhojan'
import { YatriRestroParser } from '../src/lib/ingest/parsers/yatriRestro'
import { YatriRestroBookingParser } from '../src/lib/ingest/parsers/yatriRestroBooking'
import { RelFoodParser } from '../src/lib/ingest/parsers/relfood'
import * as zoop from './fixtures/zoop'
import * as rajbhog from './fixtures/rajbhog'
import * as railrestro from './fixtures/railrestro'
import * as homebytes from './fixtures/homebytes'
import * as brotherbyte from './fixtures/brotherbyte'
import * as foodontrains from './fixtures/foodontrains'
import * as notification from './fixtures/orderNotification'
import * as yatribhojan from './fixtures/yatribhojan'
import * as yatriRestro from './fixtures/yatriRestro'
import * as yrBooking from './fixtures/yatriRestroBooking'
import * as relfood from './fixtures/relfood'

/*
 * A person teaching a layout highlights values in one real email. These
 * tests do the same with every stored sample: find the value the built-in
 * parser reads, "highlight" it, learn a rule, and check the taught layout
 * reads the same order number and the same dishes back.
 */

const RECEIVED = new Date('2026-09-10T09:00:00Z')

const CASES: [string, OrderParser, Record<string, unknown>][] = [
  ['zoop', new ZoopParser(), zoop],
  ['rajbhog', new RajBhogParser(), rajbhog],
  ['railrestro', new RailRestroParser(), railrestro],
  ['homebytes', new HomeBytesParser(), homebytes],
  ['brotherbyte', new BrotherByteParser(), brotherbyte],
  ['foodontrains', new FoodOnTrainsParser(), foodontrains],
  ['notification', new OrderNotificationParser(), notification],
  ['yatribhojan', new YatribhojanParser(), yatribhojan],
  ['yatriRestro', new YatriRestroParser(), yatriRestro],
  ['yatriRestroBooking', new YatriRestroBookingParser(), yrBooking],
  ['relfood', new RelFoodParser(), relfood],
]

function* occurrences(text: string, needle: string) {
  let from = 0
  for (;;) {
    const i = text.indexOf(needle, from)
    if (i < 0) return
    yield { start: i, end: i + needle.length }
    from = i + 1
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Highlights the order number the way a person would, trying each place it appears. */
function teachOrderId(text: string, id: string): FieldRule | null {
  for (const s of occurrences(text, id)) {
    const r = learnField(text, 'externalOrderId', s)
    if ('error' in r) continue
    const back = readField(text, r)
    if (back && readOrderId(back) === id) return r
  }
  return null
}

/** Highlights the first dish's name and its quantity, trying each candidate quantity on the line. */
function teachItems(text: string, items: { name: string; qty: number }[]): ItemsRule | null {
  const first = items[0]
  for (const n of occurrences(text.toLowerCase(), first.name.toLowerCase())) {
    const ls = text.lastIndexOf('\n', n.start - 1) + 1
    const le = text.indexOf('\n', n.end) < 0 ? text.length : text.indexOf('\n', n.end)
    // The quantity is on the dish's line, or a few lines below it.
    const below = text.slice(ls).split('\n').slice(0, 8).join('\n')
    const qtys: ({ start: number; end: number } | null)[] = []
    for (const m of below.matchAll(/\d+/g)) if (m[0] === String(first.qty)) qtys.push({ start: ls + m.index!, end: ls + m.index! + m[0].length })
    if (first.qty === 1) qtys.push(null)
    for (const q of qtys) {
      if (q && q.start < n.end && q.end > n.start) continue
      // A stacked row is taught by highlighting the whole name line.
      const nameSel = q && q.start > le ? { start: ls, end: le } : n
      const r = learnItems(text, nameSel, q)
      if ('error' in r) continue
      const got = readItems(text, r)
      if (got.length === items.length && got.every((g, i) => norm(g.name) === norm(items[i].name) && g.qty === items[i].qty)) return r
    }
  }
  return null
}

describe('template engine: taught layouts read what the built-in parsers read', () => {
  const report: string[] = []
  for (const [name, parser, mod] of CASES) {
    for (const [key, sample] of Object.entries(mod)) {
      if (typeof sample !== 'string') continue
      const built = parser.parse(sample, RECEIVED)
      if (!built.ok) continue
      it(`${name}/${key}`, () => {
        const text = normaliseBody(sample)
        const idRule = teachOrderId(text, built.order.externalOrderId)
        const itemsRule = teachItems(text, built.order.items)
        report.push(`${name}/${key}: id ${idRule ? 'ok' : 'NO'} · dishes ${itemsRule ? 'ok' : 'NO'} (${built.order.items.map((i) => `${i.name}×${i.qty}`).join(', ')})`)
        // Gmail's "Fwd:" flattening leaves no row structure to teach from.
        if (/COLLAPSED|ONE_TOKEN/.test(key)) return
        expect(idRule, 'order number teachable').not.toBeNull()
        expect(itemsRule, 'dishes teachable').not.toBeNull()
        const rules: TemplateRules = validateRules({
          fields: [idRule],
          items: itemsRule,
          fixed: { outletName: 'Kitchen', stationCode: 'CNB', paymentMode: null },
          dateOrder: 'DMY',
        })
        const run = runTemplate(sample, rules, built.order.source, RECEIVED)
        expect(run.ok).toBe(true)
        if (run.ok) {
          expect(run.order.externalOrderId).toBe(built.order.externalOrderId)
          expect(run.order.items.map((i) => [norm(i.name), i.qty])).toEqual(built.order.items.map((i) => [norm(i.name), i.qty]))
        }
      })
    }
  }
  it.runIf(process.env.TEACH_REPORT)('report', () => {
    console.log(report.join('\n'))
  })
})

describe('template engine: matching rules', () => {
  const body = 'Order No : AB123\tType : Prepaid\nCustomer Name : Ram milan\t Phone : 9335342078\nTrain : Pnvl Gkp Express/ 15066\n\nItems\n1 x Veg Thali (Veg),\n2 x Paneer Roll (Veg),\nTotal: Rs 259'
  const t = normaliseBody(body)
  const pick = (s: string) => {
    const i = t.indexOf(s)
    return { start: i, end: i + s.length }
  }

  it('anchors on the label in front, not on values earlier on the line', () => {
    const r = learnField(t, 'contactPhone', pick('9335342078'))
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.anchor).toBe('Phone :')
    expect(readField(t.replace('Ram milan', 'Sita Devi Sharma'), r)).toBe('9335342078')
  })

  it('stops a value at the next words, a tab or the end of the line', () => {
    const name = learnField(t, 'trainName', pick('Pnvl Gkp Express'))
    if ('error' in name) throw new Error(name.error)
    expect(readField(t.replace('Pnvl Gkp Express', 'Vaishali Superfast Exp'), name)).toBe('Vaishali Superfast Exp')
    const id = learnField(t, 'externalOrderId', pick('AB123'))
    if ('error' in id) throw new Error(id.error)
    expect(id.stop.kind).toBe('tab')
  })

  it('reads one dish per line from a "1 x NAME," shape, and several on one line split by pipes', () => {
    const r = learnItems(t, pick('Veg Thali (Veg)'), pick('1 x').start >= 0 ? { start: t.indexOf('1 x'), end: t.indexOf('1 x') + 1 } : null)
    if ('error' in r) throw new Error(r.error)
    expect(readItems(t, r)).toEqual([{ name: 'Veg Thali (Veg)', qty: 1 }, { name: 'Paneer Roll (Veg)', qty: 2 }])

    const piped = normaliseBody('Order Items:\nAalu Paratha - 1 | Paneer Paratha - 2 | Chai - 3\nThanks')
    const p = (s: string) => ({ start: piped.indexOf(s), end: piped.indexOf(s) + s.length })
    const pr = learnItems(piped, p('Aalu Paratha'), { start: piped.indexOf('1'), end: piped.indexOf('1') + 1 })
    if ('error' in pr) throw new Error(pr.error)
    expect(readItems(piped, pr)).toEqual([
      { name: 'Aalu Paratha', qty: 1 },
      { name: 'Paneer Paratha', qty: 2 },
      { name: 'Chai', qty: 3 },
    ])
  })

  it('treats admin text as plain words, never as a pattern', () => {
    expect(findText('price (.*)+ here', '(.*)+')).toEqual({ start: 6, end: 11 })
    expect(findText('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab', '(a+)+$')).toBeNull()
  })

  it('refuses rules with no order number or no dishes', () => {
    expect(() => validateRules({ fields: [], items: null })).toThrow(/order number/)
  })
})
