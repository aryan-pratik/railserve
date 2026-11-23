import type { ParsedOrder, ParseResult } from '../types'
import type { OrderSource } from '../../orderEnums'
import {
  EMPTY_RULES, LIMITS, TEMPLATE_FIELDS,
  type DateOrder, type FieldRule, type ItemsRule, type RowShape, type StopRule, type TemplateField, type TemplateRules,
} from './types'
import {
  readAmountPaise, readDateTime, readName, readOrderId, readOutlet, readPaymentMode, readPhone, readQty, readSeat,
  readStation, readTrainName, readTrainNo,
} from './values'

/*
 * The template engine. Pure and synchronous: the builder runs it in the
 * browser for the live preview, and ingestion runs the same code on the
 * server. Plain-text matching only; see ./types.ts for why.
 */

type Span = { start: number; end: number }

/** Line endings and odd spaces made uniform, and the size capped. */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', times: '×', middot: '·', rsquo: "'", lsquo: "'", ndash: '–', mdash: '—', bull: '•', rupee: '₹',
}

export function normaliseBody(body: string): string {
  return body
    .slice(0, LIMITS.body)
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
}

const isGap = (c: string | undefined) => c === ' ' || c === '\t'

/** Collapses runs of spaces/tabs to one space; what anchors are stored as. */
export function cleanAnchor(s: string, max: number = LIMITS.anchor): string {
  return s.replace(/[ \t]+/g, ' ').replace(/\n/g, ' ').trim().slice(-max).trim()
}

/** Matches `needle` at `i`: case-insensitive, a space matching any run of spaces or tabs. */
function matchAt(text: string, needle: string, i: number, stopAtNewline = true): number {
  let p = i
  for (let j = 0; j < needle.length; j++) {
    const a = needle[j]
    if (a === ' ') {
      if (!isGap(text[p])) return -1
      while (isGap(text[p])) p++
      continue
    }
    const c = text[p]
    if (c === undefined || (stopAtNewline && c === '\n')) return -1
    if (c !== a && c.toLowerCase() !== a.toLowerCase()) return -1
    p++
  }
  return p
}

/** First match of `needle` at or after `from`, within `until`. */
export function findText(text: string, needle: string, from = 0, until = text.length): Span | null {
  if (!needle) return null
  for (let i = from; i < until; i++) {
    const end = matchAt(text, needle, i)
    if (end >= 0 && end <= until) return { start: i, end }
  }
  return null
}

function findNth(text: string, needle: string, nth: number): Span | null {
  let from = 0
  for (let k = 0; k <= nth; k++) {
    const m = findText(text, needle, from)
    if (!m) return null
    if (k === nth) return m
    from = m.start + 1
  }
  return null
}

function allMatches(text: string, needle: string, until = text.length): Span[] {
  const out: Span[] = []
  let from = 0
  while (out.length < 200) {
    const m = findText(text, needle, from, until)
    if (!m) break
    out.push(m)
    from = m.start + 1
  }
  return out
}

const lineStartOf = (text: string, i: number) => text.lastIndexOf('\n', i - 1) + 1
const lineEndOf = (text: string, i: number) => {
  const e = text.indexOf('\n', i)
  return e < 0 ? text.length : e
}

function applyStop(segment: string, stop: StopRule): string {
  if (stop.kind === 'tab') {
    const t = segment.indexOf('\t')
    return t < 0 ? segment : segment.slice(0, t)
  }
  if (stop.kind === 'text') {
    // Skip the first character so a stop of "/" never ends an empty value.
    const m = findText(segment, stop.text, 1)
    return m ? segment.slice(0, m.start) : segment
  }
  return segment
}

/** The raw text a field rule reads, or null when its anchor is not there. */
export function readField(text: string, rule: FieldRule): string | null {
  const m = findNth(text, rule.anchor, rule.nth)
  if (!m) return null
  let pos = m.end
  if (rule.where === 'nextLine') {
    pos = lineEndOf(text, m.end)
    // The value is the next line with something on it.
    for (let guard = 0; guard < 6 && pos < text.length; guard++) {
      const s = pos + 1
      const e = lineEndOf(text, s)
      if (text.slice(s, e).trim()) {
        pos = s
        break
      }
      pos = e
    }
  }
  while (isGap(text[pos])) pos++
  const segment = text.slice(pos, Math.min(lineEndOf(text, pos), pos + LIMITS.line))
  const v = applyStop(segment, rule.stop).trim()
  return v || null
}

// ---------------------------------------------------------------- learning

/** Splits a run of text into chunks at tabs, runs of 2+ spaces and pipes. */
function chunks(s: string): string[] {
  return s.split(/\t| {2,}|\|/)
}

/**
 * The label in front of a highlighted value: the last chunk with a letter in
 * it and anything after that, cut to its last four words. "Customer Name :
 * Ram\t Phone : " in front of a phone number gives "Phone :".
 */
function labelBefore(before: string): string {
  const parts = chunks(before)
  let k = parts.length - 1
  while (k > 0 && !/[A-Za-z0-9]/.test(parts[k])) k--
  const tail = cleanAnchor(parts.slice(k).join(' '))
  const words = tail.split(' ')
  let alnum = 0
  let cut = 0
  for (let i = words.length - 1; i >= 0; i--) {
    if (/[A-Za-z0-9]/.test(words[i])) alnum++
    if (alnum > 4) {
      cut = i + 1
      break
    }
  }
  return words.slice(cut).join(' ')
}

/** What follows a value on its line, as a stop rule. */
function stopAfter(after: string): StopRule {
  if (!after.trim()) return { kind: 'eol' }
  if (/^ *\t/.test(after)) return { kind: 'tab' }
  const word = after.trim().split(/\s+/)[0].slice(0, LIMITS.stopText)
  return { kind: 'text', text: (/^\s/.test(after) ? ' ' : '') + word }
}

function trimSpan(text: string, s: Span): Span {
  let { start, end } = s
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return { start, end }
}

export type LearnError = { error: string }

/**
 * A field rule from a highlight: `start`/`end` are offsets into the
 * normalised body. The value must sit on one line.
 */
export function learnField(text: string, field: TemplateField, sel: Span): FieldRule | LearnError {
  const { start, end } = trimSpan(text, sel)
  if (end <= start) return { error: 'Highlight some text first.' }
  if (text.slice(start, end).includes('\n')) return { error: 'Highlight text on one line only.' }
  const ls = lineStartOf(text, start)
  const le = lineEndOf(text, end)
  const before = text.slice(ls, start)
  const stop = stopAfter(text.slice(end, le))
  const sample = text.slice(start, end)

  if (before.trim()) {
    const anchor = labelBefore(before)
    if (!anchor) return { error: 'Could not find any words in front of this. Try the line above.' }
    // The occurrence nearest in front of the value is the one it belongs to.
    const nth = Math.max(0, allMatches(text, anchor, start).length - 1)
    return { field, anchor, nth, where: 'sameLine', stop, sample }
  }

  // The value starts its line: anchor on the nearest line above with words.
  let p = ls - 1
  while (p > 0) {
    const s = lineStartOf(text, p)
    const line = text.slice(s, p)
    if (/[A-Za-z0-9]/.test(line)) {
      const anchor = cleanAnchor(line)
      const hits = allMatches(text, anchor, p + 1)
      return { field, anchor, nth: Math.max(0, hits.length - 1), where: 'nextLine', stop, sample }
    }
    p = s - 1
  }
  return { error: 'There is nothing above this to find it by.' }
}

type Item = { name: string; qty: number }
type PatternParts = Extract<RowShape, { kind: 'pattern' }>['parts']

function unitSpans(line: string, sep: '|' | ';' | '#' | null): Span[] {
  if (!sep) return [{ start: 0, end: line.length }]
  const out: Span[] = []
  let s = 0
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line[i] === sep) {
      out.push({ start: s, end: i })
      s = i + 1
    }
  }
  return out
}

/** Cells of a row. Blank cells are kept for tabs and pipes, so columns line up. */
function cellSpans(line: string, delimiter: 'tab' | 'pipe' | 'spaces'): Span[] {
  const re = delimiter === 'tab' ? /\t/g : delimiter === 'pipe' ? /\|/g : / {2,}|\t/g
  const out: Span[] = []
  let s = 0
  for (const m of line.matchAll(re)) {
    out.push({ start: s, end: m.index! })
    s = m.index! + m[0].length
  }
  out.push({ start: s, end: line.length })
  // Drop the empty edges a leading or trailing delimiter leaves.
  while (out.length && !line.slice(out[0].start, out[0].end).trim()) out.shift()
  while (out.length && !line.slice(out[out.length - 1].start, out[out.length - 1].end).trim()) out.pop()
  return delimiter === 'spaces' ? out.filter((c) => line.slice(c.start, c.end).trim() !== '') : out
}

const QTY_ONLY = /^\s*[*_]*\s*[x×*]?\s*\d{1,4}\s*(?:[x×*]|nos?\.?|pcs?\.?|qty)?\s*[*_]*\s*$/i
const hasWord = (s: string) => /[A-Za-z]{3,}/.test(s)
const cleanName = (s: string) => s.replace(/^[\s:\-–•*_#]+|[\s,;:\-–*_#]+$/g, '').replace(/\s+/g, ' ')

/** Matches one dish at `from` in `u`; returns it and where it ended. */
function matchPatternAt(u: string, from: number, parts: PatternParts): { item: Item; end: number } | null {
  let pos = from
  while (pos < u.length && /[\s,;]/.test(u[pos])) pos++
  if (pos >= u.length) return null
  let list = parts
  if (list[0]?.kind === 'literal') {
    const at = matchAt(u, list[0].text.trim() || ' ', pos)
    if (at >= 0 && list[0].text.trim()) pos = at
    list = list.slice(1)
  }
  const last = list[list.length - 1]
  const tail = last?.kind === 'literal' ? last.text : null
  if (tail !== null) list = list.slice(0, -1)

  const got: { name?: string; qty?: string } = {}
  for (let i = 0; i < list.length; i++) {
    const part = list[i]
    if (part.kind === 'literal') continue
    const next = list[i + 1]
    let value: string
    if (next?.kind === 'literal') {
      const m = findText(u, next.text, pos + 1)
      if (!m) return null
      value = u.slice(pos, m.start)
      pos = m.end
    } else if (next) {
      // Two values side by side: a quantity is one word, a name the rest.
      const rest = u.slice(pos)
      const sp = part.kind === 'qty' ? rest.search(/\s/) : rest.trimEnd().lastIndexOf(' ')
      if (sp <= 0) return null
      value = rest.slice(0, sp)
      pos += sp
    } else {
      let end = u.length
      let after = u.length
      if (tail) {
        const m = findText(u, tail, pos + 1)
        if (m) {
          end = m.start
          after = m.end
        }
      }
      value = u.slice(pos, end)
      pos = after
    }
    got[part.kind] = value
  }
  if (got.qty !== undefined && !QTY_ONLY.test(got.qty)) return null
  const name = cleanName(got.name ?? '')
  if (!/[A-Za-z]/.test(name) || name.length > 160) return null
  const qty = readQty(got.qty ?? null)
  return qty ? { item: { name, qty }, end: pos } : null
}

function qtyCell(line: string, fromEnd: number): number | null {
  const cells = cellSpans(line, 'spaces').map((c) => line.slice(c.start, c.end))
  const c = cells[cells.length - 1 - fromEnd]
  return c !== undefined && QTY_ONLY.test(c) ? readQty(c) : null
}

function matchCells(line: string, shape: Extract<RowShape, { kind: 'cells' }>): Item | null {
  const cells = cellSpans(line, shape.delimiter).map((c) => line.slice(c.start, c.end).trim())
  if (cells.length < shape.minCols) return null
  const name = cleanName(cells[shape.nameCol] ?? '')
  if (!name || !/[A-Za-z]/.test(name) || /^(?:₹|rs\.?|inr)\s*[\d,.]+$/i.test(name)) return null
  if (shape.qtyCol === null) return { name, qty: 1 }
  for (const q of [cells[shape.qtyCol], shape.qtyFromEnd === null ? undefined : cells[cells.length - 1 - shape.qtyFromEnd]]) {
    if (q !== undefined && QTY_ONLY.test(q)) {
      const qty = readQty(q)
      if (qty) return { name, qty }
    }
  }
  return null
}

/** Every dish on one line, for the single-line shapes. */
function matchLine(line: string, shape: RowShape): Item[] {
  if (shape.kind === 'stacked') return []
  if (shape.kind === 'cells') {
    const one = matchCells(line, shape)
    return one ? [one] : []
  }
  const out: Item[] = []
  if (shape.unitSeparator) {
    for (const u of unitSpans(line, shape.unitSeparator)) {
      const one = matchPatternAt(line.slice(u.start, u.end), 0, shape.parts)
      if (one) out.push(one.item)
    }
    return out
  }
  // Several dishes can follow each other on one line ("1 x A, 3 x B,").
  let pos = 0
  for (let guard = 0; guard < 20; guard++) {
    const one = matchPatternAt(line, pos, shape.parts)
    if (!one || one.end <= pos) break
    out.push(one.item)
    pos = one.end
  }
  return out
}

function literal(s: string): string {
  return s.replace(/[ \t]+/g, ' ').slice(0, LIMITS.anchor)
}

/** The fixed words right after a dish name: up to the next letter or digit, decoration dropped. */
function tailLiteral(after: string): string | null {
  const lead = /^[^A-Za-z0-9]*/.exec(after)?.[0] ?? ''
  const cleaned = literal(lead.replace(/[*_~]/g, ''))
  return cleaned.trim() ? cleaned : null
}

/** An "Items:" style label at the start of the dish line, when there is one. */
function sameLineLabel(line: string, firstField: number): string | null {
  const before = line.slice(0, firstField)
  const m = /^\s*([A-Za-z][A-Za-z&/]*(?: [A-Za-z&/]+){0,4})\s*(\t| {2,}|:)/.exec(before)
  return m && /[A-Za-z]{3,}/.test(m[1]) ? cleanAnchor(m[1] + (m[2] === ':' ? ':' : '')) : null
}

/** The leading words of a line, up to its first number or amount: an end marker. */
function leadingWords(line: string): string | null {
  const words: string[] = []
  for (const w of cleanAnchor(line).split(' ')) {
    if (/\d|₹/.test(w) || /^rs\.?$/i.test(w) || words.length >= 3) break
    words.push(w)
  }
  const a = words.join(' ').slice(0, 40).trim()
  return hasWord(a) ? a : null
}

function nonEmptyLinesFrom(text: string, start: number, max = 400): { s: number; e: number; line: string }[] {
  const out: { s: number; e: number; line: string }[] = []
  let s = start
  while (s < text.length && out.length < max) {
    const e = lineEndOf(text, s)
    const line = text.slice(s, Math.min(e, s + LIMITS.line))
    if (line.trim()) out.push({ s, e, line })
    s = e + 1
  }
  return out
}

function stackedAt(lines: { line: string }[], i: number, shape: Extract<RowShape, { kind: 'stacked' }>): Item | null {
  const nameLine = lines[i]?.line
  const qtyLine = lines[i + shape.qtyOffset]?.line
  if (!nameLine || !qtyLine) return null
  const name = cleanName(nameLine)
  if (!hasWord(name) || name.length > 160 || /^(?:₹|rs\.?)/i.test(name)) return null
  const qty = qtyCell(qtyLine, shape.qtyFromEnd)
  return qty ? { name, qty } : null
}

/**
 * A dish rule from one example: the dish name highlighted, and its quantity
 * if the mail prints one. The quantity may be on the same line or a few
 * lines below the name.
 */
export function learnItems(text: string, nameSel: Span, qtySel: Span | null): ItemsRule | LearnError {
  const name = trimSpan(text, nameSel)
  const qty = qtySel ? trimSpan(text, qtySel) : null
  if (name.end <= name.start) return { error: 'Highlight a dish name first.' }
  if (text.slice(name.start, name.end).includes('\n')) return { error: 'Highlight the dish name on one line.' }
  if (qty && !QTY_ONLY.test(text.slice(qty.start, qty.end))) return { error: 'The quantity should be a number, like 2.' }
  if (qty && qty.start < name.end && qty.end > name.start) return { error: 'The name and the quantity overlap. Highlight them separately.' }
  const ls = lineStartOf(text, name.start)
  const le = lineEndOf(text, name.start)

  let shape: RowShape | null = null
  let rowLine = text.slice(ls, le)
  let label: string | null = null
  let lastRowEnd = le

  if (qty && qty.start > le) {
    // The quantity is below the name: count the lines with something on them.
    const below = nonEmptyLinesFrom(text, le + 1, 8)
    const k = below.findIndex((l) => l.s <= qty.start && qty.end <= l.e)
    if (k < 0) return { error: 'The quantity should be on the same line as the name, or just below it.' }
    if (rowLine.trim() !== text.slice(name.start, name.end)) return { error: 'Highlight the whole dish name line.' }
    const qLine = below[k].line
    const cells = cellSpans(qLine, 'spaces')
    const qi = cells.findIndex((c) => below[k].s + c.start <= qty.start && qty.end <= below[k].s + c.end)
    if (qi < 0) return { error: 'Could not find that quantity in its line.' }
    shape = { kind: 'stacked', qtyOffset: k + 1, qtyFromEnd: cells.length - 1 - qi }
    lastRowEnd = below[k].e
  } else {
    if (qty && (qty.start < ls || qty.end > le)) return { error: 'The quantity should be on the same line as the name, or just below it.' }
    const first = Math.min(name.start, qty?.start ?? name.start) - ls
    label = sameLineLabel(rowLine, first)
    const off = label ? (findText(rowLine, label)?.end ?? 0) : 0
    const row = rowLine.slice(off)
    const n = { start: name.start - ls - off, end: name.end - ls - off }
    const q = qty ? { start: qty.start - ls - off, end: qty.end - ls - off } : null

    const sameChunk = (sep: '|' | ';' | '#') =>
      row.includes(sep) && unitSpans(row, sep).some((u) => u.start <= n.start && n.end <= u.end && (!q || (u.start <= q.start && q.end <= u.end)))
    const unitSep = sameChunk('|') ? '|' : sameChunk('#') ? '#' : sameChunk(';') ? ';' : null

    if (!unitSep) {
      for (const delimiter of ['tab', 'pipe', 'spaces'] as const) {
        const cells = cellSpans(row, delimiter)
        if (cells.length < 2) continue
        const at = (s: Span) => cells.findIndex((c) => c.start <= s.start && s.end <= c.end)
        const nameCol = at(n)
        const qtyCol = q ? at(q) : null
        if (nameCol < 0 || (q && (qtyCol === null || qtyCol < 0 || qtyCol === nameCol))) continue
        if (cleanName(row.slice(cells[nameCol].start, cells[nameCol].end)) !== cleanName(row.slice(n.start, n.end))) continue
        shape = {
          kind: 'cells', delimiter, nameCol,
          qtyCol: qtyCol ?? null,
          qtyFromEnd: qtyCol === null ? null : cells.length - 1 - qtyCol,
          minCols: Math.max(nameCol, qtyCol ?? 0) + 1,
        }
        break
      }
    }
    if (!shape) {
      const unit = unitSpans(row, unitSep).find((u) => u.start <= n.start && n.end <= u.end)!
      const marks = [{ kind: 'name' as const, s: n }, ...(q ? [{ kind: 'qty' as const, s: q }] : [])].sort((a, b) => a.s.start - b.s.start)
      const parts: PatternParts = []
      const lead = /[^A-Za-z0-9]*$/.exec(row.slice(unit.start, marks[0].s.start))?.[0] ?? ''
      if (lead.replace(/[*_~\s]/g, '')) parts.push({ kind: 'literal', text: literal(lead.replace(/[*_~]/g, '')) })
      parts.push({ kind: marks[0].kind })
      if (marks[1]) {
        const mid = literal(row.slice(marks[0].s.end, marks[1].s.start))
        if (mid) parts.push({ kind: 'literal', text: mid.trim() ? mid : ' ' })
        parts.push({ kind: marks[1].kind })
      }
      const tail = tailLiteral(row.slice(marks[marks.length - 1].s.end, unit.end))
      if (tail) parts.push({ kind: 'literal', text: tail })
      shape = { kind: 'pattern', parts, unitSeparator: unitSep }
    }
    rowLine = row
    if (matchLine(row, shape).length === 0) return { error: 'Could not read that row back. Try highlighting the name and quantity again.' }
  }

  // Where the dishes start: the label on the dish line, or the nearest line
  // above with words that is not itself a dish.
  let startAnchor = label ?? ''
  let startNth = 0
  if (label) {
    startNth = Math.max(0, allMatches(text, label, name.start).length - 1)
  } else {
    let p = ls - 1
    while (p > 0) {
      const s = lineStartOf(text, p)
      const above = text.slice(s, p)
      const isRow = shape.kind === 'stacked' ? false : matchLine(above, shape).length > 0
      if (/[A-Za-z0-9]/.test(above) && !isRow) {
        startAnchor = cleanAnchor(above)
        break
      }
      p = s - 1
    }
    if (!startAnchor) return { error: 'There is no heading above the dishes to find them by.' }
    startNth = Math.max(0, allMatches(text, startAnchor, ls).length - 1)
  }

  // Where they end: the first later line with words that is not a dish.
  let endAnchor: string | null = null
  const later = nonEmptyLinesFrom(text, lastRowEnd + 1, 60)
  for (let i = 0; i < later.length; i++) {
    const l = later[i].line
    if (!hasWord(l)) continue
    const isRow = shape.kind === 'stacked' ? stackedAt(later, i, shape) !== null : matchLine(l, shape).length > 0
    if (isRow) {
      if (shape.kind === 'stacked') i += shape.qtyOffset
      continue
    }
    endAnchor = leadingWords(l)
    if (endAnchor) break
  }

  return { startAnchor, startNth, startSameLine: Boolean(label), endAnchor, shape, sample: rowLine.trim().slice(0, 300) }
}

/** "Dishes end before" chosen by tapping a line on the builder. */
export function endAnchorFromLine(line: string): string | null {
  return leadingWords(line) ?? (cleanAnchor(line).slice(0, 40) || null)
}

/** Every dish an items rule finds in a body. */
export function readItems(text: string, rule: ItemsRule): Item[] {
  const m = findNth(text, rule.startAnchor, rule.startNth)
  if (!m) return []
  const lines = nonEmptyLinesFrom(text, rule.startSameLine ? m.end : lineEndOf(text, m.end) + 1)
  const ends = (l: string) => rule.endAnchor !== null && matchAt(l.trimStart(), rule.endAnchor, 0) >= 0
  const items: Item[] = []
  for (let i = 0; i < lines.length && items.length < LIMITS.items; i++) {
    const line = lines[i].line
    if (ends(line)) break
    let got: Item[] = []
    if (rule.shape.kind === 'stacked') {
      const one = stackedAt(lines, i, rule.shape)
      if (one && !lines.slice(i + 1, i + rule.shape.qtyOffset + 1).some((x) => ends(x.line))) {
        got = [one]
        i += rule.shape.qtyOffset
      }
    } else {
      got = matchLine(line, rule.shape)
    }
    if (got.length) items.push(...got)
    else if (!rule.endAnchor && items.length) break
  }
  return items.slice(0, LIMITS.items)
}

// ------------------------------------------------------------------ running

export type TemplateRead = {
  raw: Partial<Record<TemplateField, string | null>>
  items: { name: string; qty: number }[]
}

export function readAll(body: string, rules: TemplateRules): TemplateRead {
  const text = normaliseBody(body)
  const raw: TemplateRead['raw'] = {}
  for (const r of rules.fields) raw[r.field] = readField(text, r)
  return { raw, items: rules.items ? readItems(text, rules.items) : [] }
}

/** Cheap check before parsing: the order number and the dish heading are there. */
export function templateMatches(body: string, rules: TemplateRules): boolean {
  const text = normaliseBody(body)
  const id = rules.fields.find((f) => f.field === 'externalOrderId')
  if (!id || !rules.items) return false
  return findNth(text, id.anchor, id.nth) !== null && findNth(text, rules.items.startAnchor, rules.items.startNth) !== null
}

/** The order a template reads from a body, in the same shape a built-in parser returns. */
export function runTemplate(body: string, rules: TemplateRules, source: OrderSource, receivedAt: Date): ParseResult {
  const { raw, items } = readAll(body, rules)
  const partial: Partial<ParsedOrder> = { source }

  const externalOrderId = raw.externalOrderId ? readOrderId(raw.externalOrderId) : null
  if (!externalOrderId) return { ok: false, reason: 'PARSE_FAILED', detail: 'order number not found (taught layout)', partial }
  partial.externalOrderId = externalOrderId

  const outletName = (raw.outletName ? readOutlet(raw.outletName) : null) ?? rules.fixed.outletName
  const station = raw.stationCode ? readStation(raw.stationCode) : { code: null, name: null }
  const stationCode = station.code ?? rules.fixed.stationCode ?? null
  const trainRaw = raw.trainNo ?? null
  const trainNo = trainRaw ? readTrainNo(trainRaw) : raw.trainName ? readTrainNo(raw.trainName) : null
  const trainName = raw.trainName ? readTrainName(raw.trainName) : trainRaw && /[A-Za-z]{2}/.test(trainRaw) ? readTrainName(trainRaw) : null
  const seat = raw.seat ? readSeat(raw.seat) : { coach: null, berth: null, rawSeat: null }
  const paymentMode = (raw.paymentMode ? readPaymentMode(raw.paymentMode) : null) ?? rules.fixed.paymentMode
  const amountPaise = raw.amount ? readAmountPaise(raw.amount) : null
  const scheduledArrival = raw.arrival ? readDateTime(raw.arrival, receivedAt, rules.dateOrder) : null

  Object.assign(partial, {
    outletName: outletName ?? undefined, stationCode, stationName: station.name, trainNo, trainName,
    contactName: raw.contactName ? readName(raw.contactName) : null,
    contactPhone: raw.contactPhone ? readPhone(raw.contactPhone) : null,
    ...seat, scheduledArrival, amountPaise, paymentMode,
    items: items.map((i) => ({ ...i, notes: null })),
  })

  if (!outletName) return { ok: false, reason: 'MISSING_FIELD', detail: 'outlet name missing (taught layout)', partial }
  if (items.length === 0) return { ok: false, reason: 'MISSING_FIELD', detail: 'no dishes found (taught layout)', partial }

  return {
    ok: true,
    order: {
      source,
      externalOrderId,
      outletName,
      stationName: station.name,
      stationCode,
      contactName: partial.contactName ?? null,
      contactPhone: partial.contactPhone ?? null,
      trainNo,
      trainName,
      coach: seat.coach,
      berth: seat.berth,
      rawSeat: seat.rawSeat,
      scheduledArrival,
      items: items.map((i) => ({ ...i, notes: null })),
      amountPaise,
      paymentMode,
    },
  }
}

// --------------------------------------------------------------- validation

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

function cleanStop(v: unknown): StopRule {
  const o = (v ?? {}) as { kind?: unknown; text?: unknown }
  if (o.kind === 'tab') return { kind: 'tab' }
  if (o.kind === 'text') {
    const t = str(o.text, LIMITS.stopText)
    if (t && t.trim()) return { kind: 'text', text: t.replace(/[ \t]+/g, ' ') }
  }
  return { kind: 'eol' }
}

/**
 * Rules as they arrive from the browser, checked and capped before they are
 * stored or run. Throws a message fit to show on the builder.
 */
export function validateRules(input: unknown): TemplateRules {
  const o = (input ?? {}) as Record<string, unknown>
  const seen = new Set<string>()
  const fields: FieldRule[] = []
  for (const f of Array.isArray(o.fields) ? o.fields.slice(0, LIMITS.fields) : []) {
    const r = f as Record<string, unknown>
    const field = r.field as TemplateField
    if (!TEMPLATE_FIELDS.includes(field) || seen.has(field)) continue
    const anchor = str(r.anchor, LIMITS.anchor)
    if (!anchor || !anchor.trim()) throw new Error(`"${field}" has no words to find it by.`)
    seen.add(field)
    fields.push({
      field,
      anchor: cleanAnchor(anchor),
      nth: Math.min(50, Math.max(0, Math.floor(Number(r.nth) || 0))),
      where: r.where === 'nextLine' ? 'nextLine' : 'sameLine',
      stop: cleanStop(r.stop),
      sample: str(r.sample, 200) ?? undefined,
    })
  }
  if (!seen.has('externalOrderId')) throw new Error('Mark the order number.')

  const it = o.items as Record<string, unknown> | null
  if (!it) throw new Error('Mark one dish and its quantity.')
  const startAnchor = str(it.startAnchor, LIMITS.anchor)
  if (!startAnchor) throw new Error('The dishes have no heading to find them by.')
  const sh = (it.shape ?? {}) as Record<string, unknown>
  let shape: RowShape
  if (sh.kind === 'cells') {
    const col = (v: unknown) => Math.min(30, Math.max(0, Math.floor(Number(v) || 0)))
    shape = {
      kind: 'cells',
      delimiter: sh.delimiter === 'pipe' ? 'pipe' : sh.delimiter === 'spaces' ? 'spaces' : 'tab',
      nameCol: col(sh.nameCol),
      qtyCol: sh.qtyCol === null || sh.qtyCol === undefined ? null : col(sh.qtyCol),
      qtyFromEnd: sh.qtyFromEnd === null || sh.qtyFromEnd === undefined ? null : col(sh.qtyFromEnd),
      minCols: Math.min(31, Math.max(1, Math.floor(Number(sh.minCols) || 1))),
    }
  } else if (sh.kind === 'stacked') {
    shape = {
      kind: 'stacked',
      qtyOffset: Math.min(6, Math.max(1, Math.floor(Number(sh.qtyOffset) || 1))),
      qtyFromEnd: Math.min(20, Math.max(0, Math.floor(Number(sh.qtyFromEnd) || 0))),
    }
  } else if (sh.kind === 'pattern') {
    const parts: Extract<RowShape, { kind: 'pattern' }>['parts'] = []
    for (const p of Array.isArray(sh.parts) ? sh.parts.slice(0, LIMITS.patternParts) : []) {
      const k = (p as { kind?: unknown }).kind
      if (k === 'name' || k === 'qty') {
        if (!parts.some((x) => x.kind === k)) parts.push({ kind: k })
      } else if (k === 'literal') {
        const t = str((p as { text?: unknown }).text, LIMITS.anchor)
        if (t) parts.push({ kind: 'literal', text: t.replace(/[ \t]+/g, ' ') })
      }
    }
    if (!parts.some((x) => x.kind === 'name')) throw new Error('Mark the dish name.')
    const sep = sh.unitSeparator
    shape = { kind: 'pattern', parts, unitSeparator: sep === '|' || sep === ';' || sep === '#' ? sep : null }
  } else {
    throw new Error('Mark one dish and its quantity.')
  }
  const fx = (o.fixed ?? {}) as Record<string, unknown>
  const station = str(fx.stationCode, 5)
  return {
    fields,
    items: {
      startAnchor: cleanAnchor(startAnchor),
      startNth: Math.min(50, Math.max(0, Math.floor(Number(it.startNth) || 0))),
      startSameLine: it.startSameLine === true,
      endAnchor: str(it.endAnchor, LIMITS.anchor) ? cleanAnchor(it.endAnchor as string) : null,
      shape,
      sample: str(it.sample, 300) ?? undefined,
    },
    fixed: {
      outletName: str(fx.outletName, 120)?.trim() || null,
      stationCode: station && /^[A-Za-z]{2,5}$/.test(station) ? station.toUpperCase() : null,
      paymentMode: fx.paymentMode === 'PREPAID' || fx.paymentMode === 'COD' ? fx.paymentMode : null,
    },
    dateOrder: (['DMY', 'MDY', 'YMD'] as DateOrder[]).includes(o.dateOrder as DateOrder) ? (o.dateOrder as DateOrder) : EMPTY_RULES.dateOrder,
  }
}
