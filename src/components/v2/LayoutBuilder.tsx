'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Circle, Mail, RotateCcw, Utensils, X } from 'lucide-react'
import { Button, Card, Chip, Mono, cx, v2Focus } from './ui'
import { Notice, Table, TableFrame, Td, Th } from './Table'
import { Field, checkboxClass, inputClass, textareaClass } from './SettingsForm'
import { Select } from './Select'
import { FIELD_LABEL, TEMPLATE_FIELDS, type DateOrder, type FieldRule, type TemplateField, type TemplateRules } from '@/lib/ingest/templates/types'
import { endAnchorFromLine, findText, learnField, learnItems, normaliseBody, readAll } from '@/lib/ingest/templates/engine'
import { normaliseSenderEntry, senderAddress } from '@/lib/ingest/senders'
import { saveLayout, testLayout, type SampleEmail, type TestRow } from '@/app/v2/settings/mailActions'

/*
 * "Teach a new email layout". The admin sees one real email as plain text,
 * highlights a value and says what it is; the engine learns a rule from each
 * highlight and the right-hand column shows what the layout reads. Every
 * offset here is into normaliseBody(sample), and the email block renders
 * exactly that text, one <div data-start> per line, so a browser selection
 * maps back to characters with no guessing. Labels on highlights are CSS
 * pseudo-elements, which are not text and never shift an offset.
 */

type Span = { start: number; end: number }

export type LayoutInitial = {
  key: string | null
  name: string
  source: string
  senders: string[]
  requireVerified: boolean
  rules: TemplateRules
  sample: string
  sampleReceivedAt: string | null
}

const BACK = '/v2/settings?tab=mail'

/** Field highlight colours, cycled; dishes always use the brand tint. */
const TONES = [
  'bg-v2-info-bg text-v2-info before:bg-v2-info',
  'bg-v2-warn-bg text-v2-warn before:bg-v2-warn',
  'bg-v2-cod-bg text-v2-cod before:bg-v2-cod',
  'bg-v2-ok-bg text-v2-ok before:bg-v2-ok',
  'bg-v2-bad-bg text-v2-bad before:bg-v2-bad',
]
const toneFor = (f: TemplateField) => TONES[TEMPLATE_FIELDS.indexOf(f) % TONES.length]
const DISH_TONE = 'bg-v2-brand-soft text-v2-brand before:bg-v2-brand'

const DATE_ORDERS: { value: DateOrder; label: string }[] = [
  { value: 'DMY', label: 'Day / Month / Year (25/11/2026)' },
  { value: 'MDY', label: 'Month / Day / Year (11/25/2026)' },
  { value: 'YMD', label: 'Year first (2026-11-25)' },
]

/** A fixed, timezone-pinned date so the server and the browser print the same. */
function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 330 * 60_000)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${hh}:${mm}`
}

/** Where every learned value sits in the text, for the highlights. */
function locate(text: string, rules: TemplateRules, read: ReturnType<typeof readAll>): { span: Span; tag: string; tone: string }[] {
  const out: { span: Span; tag: string; tone: string }[] = []
  const nthAnchor = (anchor: string, nth: number): Span | null => {
    let from = 0
    let hit: Span | null = null
    for (let i = 0; i <= nth; i++) {
      hit = findText(text, anchor, from)
      if (!hit) return null
      from = hit.end
    }
    return hit
  }
  for (const r of rules.fields) {
    const value = read.raw[r.field]
    if (!value || !r.anchor.trim()) continue
    const a = nthAnchor(r.anchor, r.nth)
    if (!a) continue
    const v = findText(text, value, a.end)
    if (v) out.push({ span: v, tag: FIELD_LABEL[r.field], tone: toneFor(r.field) })
  }
  if (rules.items && rules.items.startAnchor.trim()) {
    const a = nthAnchor(rules.items.startAnchor, rules.items.startNth)
    let from = a?.end ?? 0
    if (a) {
      for (const it of read.items) {
        const v = findText(text, it.name, from)
        if (!v) continue
        out.push({ span: v, tag: 'Dish', tone: DISH_TONE })
        from = v.end
      }
    }
  }
  // Earliest first, overlaps dropped, so each character has one colour.
  out.sort((x, y) => x.span.start - y.span.start)
  const kept: typeof out = []
  for (const m of out) if (!kept.length || m.span.start >= kept[kept.length - 1].span.end) kept.push(m)
  return kept
}

/** A character offset for one end of a browser selection, or null when it is outside the email. */
function pointToOffset(root: HTMLElement, node: Node, offset: number, textLength: number): number | null {
  if (!root.contains(node)) return null
  if (node === root) {
    const kids = root.children
    if (offset >= kids.length) return textLength
    return Number((kids[offset] as HTMLElement).dataset.start ?? 0)
  }
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const line = el?.closest<HTMLElement>('[data-start]')
  if (!line || !root.contains(line)) return null
  const r = document.createRange()
  r.setStart(line, 0)
  r.setEnd(node, offset)
  return Number(line.dataset.start) + r.toString().length
}

type Picked = {
  span: Span
  /** A tapped line (its index), or a drag selection. */
  line: number | null
  /** Where the picked text is on screen now; read again as the page scrolls. */
  anchor: () => DOMRect
}

export function LayoutBuilder({ initial, sources, samples }: { initial: LayoutInitial; sources: { id: string; label: string }[]; samples: SampleEmail[] }) {
  const router = useRouter()
  const [sample, setSample] = useState(initial.sample)
  const [sampleReceivedAt, setSampleReceivedAt] = useState(initial.sampleReceivedAt)
  const [rules, setRules] = useState<TemplateRules>(initial.rules)
  const [name, setName] = useState(initial.name)
  const [source, setSource] = useState(initial.source || 'OTHER')
  const [senders, setSenders] = useState<string[]>(initial.senders)
  const [requireVerified, setRequireVerified] = useState(initial.requireVerified)

  const text = useMemo(() => normaliseBody(sample), [sample])
  // readAll normalises on its own: hand it the raw sample, like the server does.
  const read = useMemo(() => readAll(sample, rules), [sample, rules])

  const [pasted, setPasted] = useState('')
  const [rows, setRows] = useState<TestRow[] | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testing, startTest] = useTransition()
  const [saving, startSave] = useTransition()

  const chooseSample = (body: string, receivedAt: string | null, from: string | null) => {
    setSample(body)
    setSampleReceivedAt(receivedAt)
    // A new layout starts clean; an existing one keeps its marks, since rules
    // are words, not positions, and the preview shows what still reads.
    if (initial.key === null) setRules((r) => ({ ...r, fields: [], items: null }))
    setRows(null)
    const address = senderAddress(from)
    if (address && senders.length === 0) setSenders([address])
  }

  const changeRules = (next: TemplateRules) => {
    setRules(next)
    setRows(null)
  }

  // What must be there before saving; each line in plain words.
  const missing: string[] = []
  if (!rules.fields.some((f) => f.field === 'externalOrderId')) missing.push('Mark the order number')
  if (!rules.items) missing.push('Mark one dish')
  else if (read.items.length === 0) missing.push('The dishes are marked, but none are found. Check "Dishes start after"')
  if (senders.length === 0) missing.push('Add the address these emails come from')
  if (!name.trim()) missing.push('Give this layout a name')
  if (rules.fields.some((f) => !f.anchor.trim())) missing.push('Every marked item needs the words it is found after')
  const fixedStation = rules.fixed.stationCode ?? ''
  if (fixedStation && !/^[A-Z]{2,5}$/.test(fixedStation)) missing.push('Station code should be 2 to 5 letters, like NDLS')

  const tryIt = () => {
    setTestError(null)
    startTest(async () => {
      const r = await testLayout({ rules, source, senders, sample, sampleReceivedAt })
      if (r.error) {
        setTestError(r.error)
        setRows(null)
      } else setRows(r.rows ?? [])
    })
  }

  const save = () => {
    setSaveError(null)
    startSave(async () => {
      const r = await saveLayout({ key: initial.key, name, source, senders, requireVerified, rules, sample, sampleReceivedAt })
      if (r.error) setSaveError(r.error)
      else router.push(BACK)
    })
  }

  if (!sample.trim()) {
    return (
      <PickEmail
        samples={samples}
        pasted={pasted}
        setPasted={setPasted}
        onPick={(s) => chooseSample(s.body, s.receivedAt, s.from)}
        onPaste={() => chooseSample(pasted, null, null)}
      />
    )
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <TeachEmail text={text} rules={rules} read={read} onRules={changeRules} onReset={() => chooseSample('', null, null)} />
        <WhatItReads rules={rules} read={read} onRules={changeRules} />
      </div>

      <Card title="About this layout">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Field label="Name" htmlFor="layout-name" hint="Only you see this. Something like “TrainBites orders”.">
            <input id="layout-name" className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="TrainBites orders" />
          </Field>
          <Field label="Which aggregator is this?" htmlFor="layout-source" hint="Pick “Other” if it is not in the list.">
            <Select id="layout-source" value={source} onChange={setSource} options={sources.map((s) => ({ value: s.id, label: s.label }))} />
          </Field>
        </div>

        <SenderChips senders={senders} onChange={setSenders} />

        <label className="flex cursor-pointer items-start gap-3 rounded-v2-md border border-v2-line px-3 py-2.5 hover:bg-v2-surface-2">
          <input type="checkbox" checked={requireVerified} onChange={(e) => setRequireVerified(e.target.checked)} className={cx(checkboxClass, 'mt-0.5')} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Only accept mail Gmail confirms is genuine</span>
            <span className="block text-xs text-v2-muted">Turn this on if the sender signs its mail. Copies sent by someone pretending to be them are then ignored.</span>
          </span>
        </label>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
          {!rules.fields.some((f) => f.field === 'outletName') ? (
            <Field label="Kitchen / outlet (optional)" htmlFor="layout-outlet" hint="Every order from this sender goes to the outlet named…">
              <input
                id="layout-outlet"
                className={inputClass}
                value={rules.fixed.outletName ?? ''}
                maxLength={120}
                onChange={(e) => changeRules({ ...rules, fixed: { ...rules.fixed, outletName: e.target.value || null } })}
                placeholder="Leave empty if the email names it"
              />
            </Field>
          ) : null}
          <Field label="Station code (optional)" htmlFor="layout-station" hint="If every order is for one station, like NDLS.">
            <input
              id="layout-station"
              className={cx(inputClass, 'font-mono uppercase')}
              value={fixedStation}
              maxLength={5}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)
                changeRules({ ...rules, fixed: { ...rules.fixed, stationCode: v || null } })
              }}
              placeholder="NDLS"
            />
          </Field>
          <Field label="Dates are written as" htmlFor="layout-dates">
            <Select
              id="layout-dates"
              value={rules.dateOrder}
              onChange={(v) => changeRules({ ...rules, dateOrder: v as DateOrder })}
              options={DATE_ORDERS}
            />
          </Field>
        </div>
      </Card>

      <Card title="Check and save">
        {missing.length ? (
          <ul className="grid gap-1.5 text-sm" aria-label="Still to do">
            {missing.map((m) => (
              <li key={m} className="flex items-start gap-2 text-v2-ink-2">
                <Circle size={16} className="mt-0.5 shrink-0 text-v2-faint" aria-hidden />
                {m}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-v2-ok">
            <CheckCircle2 size={16} aria-hidden /> Everything needed is marked.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={tryIt} disabled={testing || !rules.items || !rules.fields.some((f) => f.field === 'externalOrderId')}>
            {testing ? 'Trying…' : 'Try on recent emails'}
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || missing.length > 0}>
            {saving ? 'Saving…' : 'Save layout'}
          </Button>
        </div>
        {testError ? <Notice tone="bad">{testError}</Notice> : null}
        {saveError ? <Notice tone="bad">{saveError}</Notice> : null}
        {rows ? <TestResults rows={rows} hasSenders={senders.length > 0} /> : null}
      </Card>
    </div>
  )
}

/* ── step 1 ─────────────────────────────────────────────────────────── */

function PickEmail({
  samples,
  pasted,
  setPasted,
  onPick,
  onPaste,
}: {
  samples: SampleEmail[]
  pasted: string
  setPasted: (v: string) => void
  onPick: (s: SampleEmail) => void
  onPaste: () => void
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      <Card title="Pick an email to teach from">
        <p className="text-sm text-v2-muted">Choose one order email from the new aggregator. You will mark the order number, the dishes and the rest on it.</p>
        {samples.length === 0 ? (
          <p className="rounded-v2-md border border-dashed border-v2-line-strong px-4 py-6 text-center text-sm text-v2-muted">
            No emails are waiting to be checked right now. Paste one below instead.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {samples.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  className={cx('flex w-full min-w-0 items-start gap-3 rounded-v2-md border border-v2-line px-3.5 py-3 text-left hover:bg-v2-surface-2', v2Focus)}
                >
                  <Mail size={18} className="mt-0.5 shrink-0 text-v2-muted" aria-hidden />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-[14.5px] font-semibold">{s.subject || '(no subject)'}</span>
                    <span className="truncate text-xs text-v2-muted">
                      {s.from || 'Unknown sender'}
                      {s.receivedAt ? ` · ${shortDate(s.receivedAt)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Or paste the email text">
        <label htmlFor="paste-email" className="sr-only">
          Email text
        </label>
        <textarea
          id="paste-email"
          className={cx(textareaClass, 'min-h-48 font-mono text-[13px]')}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Open the email, select all of it, copy, and paste it here."
        />
        <div>
          <Button variant="primary" onClick={onPaste} disabled={!pasted.trim()}>
            Use this email
          </Button>
        </div>
      </Card>
    </div>
  )
}

/* ── the email, with highlighting ───────────────────────────────────── */

function TeachEmail({
  text,
  rules,
  read,
  onRules,
  onReset,
}: {
  text: string
  rules: TemplateRules
  read: ReturnType<typeof readAll>
  onRules: (r: TemplateRules) => void
  onReset: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const pre = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dishName, setDishName] = useState<Span | null>(null)
  const [dishQty, setDishQty] = useState<Span | null>(null)

  const lines = useMemo(() => {
    const out: { start: number; text: string }[] = []
    let start = 0
    for (const t of text.split('\n')) {
      out.push({ start, text: t })
      start += t.length + 1
    }
    return out
  }, [text])

  const marks = useMemo(() => locate(text, rules, read), [text, rules, read])

  const place = useCallback((anchor: () => DOMRect, span: Span, line: number | null) => {
    setNarrow(window.innerWidth < 640)
    setPicked({ span, line, anchor })
  }, [])

  // A drag (mouse) or a long-press (touch) selection inside the email.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onChange = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const root = pre.current
        const sel = window.getSelection()
        if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
        const r = sel.getRangeAt(0)
        const start = pointToOffset(root, r.startContainer, r.startOffset, text.length)
        const end = pointToOffset(root, r.endContainer, r.endOffset, text.length)
        if (start === null || end === null || end <= start) return
        if (!text.slice(start, end).trim()) return
        setError(null)
        const range = r.cloneRange()
        place(() => range.getBoundingClientRect(), { start, end }, null)
      }, 220)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      if (t) clearTimeout(t)
    }
  }, [text, place])

  // Escape closes the bar.
  useEffect(() => {
    if (!picked) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPicked(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [picked])

  const close = () => {
    setPicked(null)
    window.getSelection()?.removeAllRanges()
  }

  // A tap with no drag picks the whole line.
  const tapLine = (i: number, el: HTMLElement) => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    const l = lines[i]
    if (!l.text.trim()) return setPicked(null)
    const lead = l.text.length - l.text.trimStart().length
    const span = { start: l.start + lead, end: l.start + l.text.trimEnd().length }
    setError(null)
    place(() => el.getBoundingClientRect(), span, i)
  }

  const markField = (field: TemplateField) => {
    if (!picked) return
    const r = learnField(text, field, picked.span)
    if ('error' in r) return setError(r.error)
    onRules({ ...rules, fields: [...rules.fields.filter((f) => f.field !== field), r] })
    close()
  }

  const learnDish = (name: Span, qty: Span | null) => {
    const r = learnItems(text, name, qty)
    if ('error' in r) {
      setError(r.error)
      return
    }
    onRules({ ...rules, items: r })
    setDishName(null)
    setDishQty(null)
  }

  const markDishName = () => {
    if (!picked) return
    const span = picked.span
    close()
    setDishName(span)
    if (dishQty) learnDish(span, dishQty)
  }

  const markDishQty = () => {
    if (!picked) return
    const span = picked.span
    close()
    setDishQty(span)
    if (dishName) learnDish(dishName, span)
  }

  const endHere = () => {
    if (!picked || picked.line === null || !rules.items) return
    const anchor = endAnchorFromLine(lines[picked.line].text)
    if (!anchor) return setError('This line has no words to stop at. Pick a line with words.')
    onRules({ ...rules, items: { ...rules.items, endAnchor: anchor } })
    close()
  }

  const marked = new Set(rules.fields.map((f) => f.field))
  const bar = picked ? (
    <PickerBar
      narrow={narrow}
      anchor={picked.anchor}
      picked={text.slice(picked.span.start, picked.span.end)}
      marked={marked}
      waitingFor={dishName && !dishQty ? 'qty' : dishQty && !dishName ? 'name' : null}
      canEnd={picked.line !== null && rules.items !== null}
      onField={markField}
      onDishName={markDishName}
      onDishQty={markDishQty}
      onEnd={endHere}
      onClose={close}
    />
  ) : null

  return (
    <Card
      title="The email"
      action={
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RotateCcw size={14} aria-hidden /> Use a different email
        </Button>
      }
    >
      <p className="text-sm text-v2-muted">
        Highlight a value with your mouse, or tap a line, then say what it is. For dishes, mark one dish name and its quantity; the rest are found the same way.
      </p>
      {dishName || dishQty ? (
        <Notice tone="info">
          {dishName && !dishQty ? (
            <>
              Dish name marked. Now highlight <strong>its quantity</strong>, or{' '}
              <button type="button" className={cx('font-semibold text-v2-brand underline', v2Focus)} onClick={() => learnDish(dishName, null)}>
                this dish has no quantity
              </button>
              .
            </>
          ) : (
            <>Quantity marked. Now highlight <strong>the dish name</strong> it belongs to.</>
          )}{' '}
          <button
            type="button"
            className={cx('font-semibold text-v2-muted underline', v2Focus)}
            onClick={() => {
              setDishName(null)
              setDishQty(null)
            }}
          >
            Start over
          </button>
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div ref={box} className="relative max-h-[70vh] min-w-0 overflow-y-auto rounded-v2-md border border-v2-line bg-v2-surface-2 p-3 [overscroll-behavior:contain]">
        <div
          ref={pre}
          className="font-mono text-[13px] leading-[1.7] whitespace-pre-wrap text-v2-ink [overflow-wrap:anywhere] [tab-size:4]"
          aria-label="Email text"
        >
          {lines.map((l, i) => (
            <Line
              key={i}
              index={i}
              line={l}
              marks={marks}
              pending={[dishName, dishQty].filter((s): s is Span => s !== null)}
              picked={picked?.line === i}
              onTap={tapLine}
            />
          ))}
        </div>
      </div>
      {/* Drawn on the page, not inside the email's scroll box, so it is never clipped. */}
      {bar ? createPortal(bar, document.body) : null}
    </Card>
  )
}

function Line({
  index,
  line,
  marks,
  pending,
  picked,
  onTap,
}: {
  index: number
  line: { start: number; text: string }
  marks: { span: Span; tag: string; tone: string }[]
  pending: Span[]
  picked: boolean
  onTap: (i: number, el: HTMLElement) => void
}) {
  const end = line.start + line.text.length
  // Cut the line at every highlight edge; text nodes only, so offsets stay exact.
  const pieces: ReactNode[] = []
  let p = line.start
  const here = marks.filter((m) => m.span.start < end && m.span.end > line.start)
  for (const m of here) {
    const s = Math.max(m.span.start, line.start)
    const e = Math.min(m.span.end, end)
    if (s > p) pieces.push(line.text.slice(p - line.start, s - line.start))
    pieces.push(
      <span
        key={s}
        data-tag={m.span.start >= line.start ? m.tag : undefined}
        className={cx(
          'rounded-[4px] px-px font-semibold',
          m.tone,
          m.span.start >= line.start &&
            'before:mr-1 before:inline-block before:rounded-[4px] before:px-1 before:align-[1px] before:font-sans before:text-[10px] before:leading-[15px] before:font-bold before:text-white before:content-[attr(data-tag)]',
        )}
      >
        {line.text.slice(s - line.start, e - line.start)}
      </span>,
    )
    p = e
  }
  if (p < end) pieces.push(line.text.slice(p - line.start))
  const isPending = pending.some((s) => s.start < end && s.end > line.start)

  return (
    <div
      data-start={line.start}
      onClick={(e) => onTap(index, e.currentTarget)}
      className={cx(
        'min-h-[1.7em] cursor-text rounded-sm px-1',
        picked && 'bg-v2-sunken',
        isPending && 'outline-2 outline-dashed outline-v2-brand',
      )}
    >
      {pieces}
    </div>
  )
}

function PickerBar({
  narrow,
  anchor,
  picked,
  marked,
  waitingFor,
  canEnd,
  onField,
  onDishName,
  onDishQty,
  onEnd,
  onClose,
}: {
  narrow: boolean
  anchor: () => DOMRect
  picked: string
  marked: Set<TemplateField>
  waitingFor: 'name' | 'qty' | null
  canEnd: boolean
  onField: (f: TemplateField) => void
  onDishName: () => void
  onDishQty: () => void
  onEnd: () => void
  onClose: () => void
}) {
  const shown = picked.length > 60 ? `${picked.slice(0, 57)}…` : picked
  const ref = useRef<HTMLDivElement>(null)
  // Below the picked text if it fits, else above it, else as high as the
  // screen allows; always fully inside the window. Placed again whenever the
  // page or the email scrolls, so it stays beside its line.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || narrow) return
    const layout = () => {
      const a = anchor()
      const gap = 8
      const h = el.offsetHeight
      const w = el.offsetWidth
      const vh = window.innerHeight
      const vw = window.innerWidth
      let top = a.bottom + gap
      if (top + h > vh - gap) top = a.top - gap - h >= gap ? a.top - gap - h : Math.max(gap, vh - h - gap)
      el.style.top = `${top}px`
      el.style.left = `${Math.max(gap, Math.min(a.left, vw - w - gap))}px`
      el.style.visibility = 'visible'
    }
    layout()
    let frame = 0
    const again = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(layout)
    }
    window.addEventListener('scroll', again, true)
    window.addEventListener('resize', again)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', again, true)
      window.removeEventListener('resize', again)
    }
  }, [anchor, narrow, picked])
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="What is this?"
      // Keep the highlight: pressing a button must not clear the selection first.
      onMouseDown={(e) => e.preventDefault()}
      // Measured and placed in the effect above; hidden until then so it never flashes in the corner.
      style={narrow ? undefined : { top: 0, left: 0, visibility: 'hidden' }}
      className={cx(
        'z-[70] grid gap-2.5 rounded-v2-lg border border-v2-line bg-v2-surface p-3 shadow-v2-pop',
        narrow ? 'fixed inset-x-3 bottom-3 max-h-[55vh] overflow-y-auto' : 'fixed max-h-[calc(100vh-16px)] w-[360px] max-w-[calc(100vw-16px)] overflow-y-auto',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13px] text-v2-muted">
          This is: <Mono className="font-semibold text-v2-ink [overflow-wrap:anywhere]">{shown}</Mono>
        </p>
        <button type="button" aria-label="Close" onClick={onClose} className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2', v2Focus)}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={waitingFor === 'name' ? 'primary' : 'soft'} onClick={onDishName}>
          <Utensils size={13} aria-hidden /> Dish name
        </Button>
        <Button size="sm" variant={waitingFor === 'qty' ? 'primary' : 'soft'} onClick={onDishQty}>
          Dish quantity
        </Button>
        {canEnd ? (
          <Button size="sm" variant="ghost" onClick={onEnd}>
            Dishes end here
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATE_FIELDS.map((f) => (
          <Button key={f} size="sm" onClick={() => onField(f)}>
            {marked.has(f) ? <Check size={13} className="text-v2-ok" aria-hidden /> : null}
            {FIELD_LABEL[f]}
          </Button>
        ))}
      </div>
    </div>
  )
}

/* ── the live preview ───────────────────────────────────────────────── */

function WhatItReads({ rules, read, onRules }: { rules: TemplateRules; read: ReturnType<typeof readAll>; onRules: (r: TemplateRules) => void }) {
  const byField = new Map(rules.fields.map((f) => [f.field, f]))
  const setRule = (field: TemplateField, patch: Partial<FieldRule>) =>
    onRules({ ...rules, fields: rules.fields.map((f) => (f.field === field ? { ...f, ...patch } : f)) })
  const remove = (field: TemplateField) => onRules({ ...rules, fields: rules.fields.filter((f) => f.field !== field) })
  const items = rules.items

  return (
    <Card title="What it reads" className="lg:sticky lg:top-4">
      <dl className="grid gap-2.5">
        {TEMPLATE_FIELDS.map((f) => {
          const rule = byField.get(f)
          const value = read.raw[f] ?? null
          return (
            <div key={f} className="grid min-w-0 gap-1 border-b border-v2-line pb-2.5 last:border-b-0 last:pb-0">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <dt className="text-[12.5px] font-semibold text-v2-muted">{FIELD_LABEL[f]}</dt>
                {rule ? (
                  <button
                    type="button"
                    aria-label={`Remove ${FIELD_LABEL[f]}`}
                    title="Remove"
                    onClick={() => remove(f)}
                    className={cx('-mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
                  >
                    <X size={14} aria-hidden />
                  </button>
                ) : null}
              </div>
              <dd className="min-w-0 text-[14px] [overflow-wrap:anywhere]">
                {!rule ? (
                  <span className="text-v2-faint">Not marked yet</span>
                ) : value ? (
                  <span className="font-semibold">{value}</span>
                ) : (
                  <span className="font-medium text-v2-warn">Marked, but not found in this email</span>
                )}
              </dd>
              {rule ? (
                <label className="flex min-w-0 items-center gap-2 text-xs text-v2-muted">
                  <span className="shrink-0">{rule.where === 'nextLine' ? 'On the line under:' : 'Found after:'}</span>
                  <input
                    className={cx(inputClass, 'h-8 flex-1 font-mono text-[12.5px]')}
                    value={rule.anchor}
                    maxLength={120}
                    onChange={(e) => setRule(f, { anchor: e.target.value })}
                  />
                </label>
              ) : null}
            </div>
          )
        })}
      </dl>

      <div className="grid gap-2 rounded-v2-md border border-v2-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[14px] font-bold">Dishes</h4>
          {items ? (
            <button
              type="button"
              aria-label="Remove dishes"
              title="Remove"
              onClick={() => onRules({ ...rules, items: null })}
              className={cx('grid h-7 w-7 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
        {!items ? (
          <p className="text-[14px] text-v2-faint">Not marked yet</p>
        ) : read.items.length === 0 ? (
          <p className="text-[14px] font-medium text-v2-warn">Marked, but no dishes found in this email</p>
        ) : (
          <ul className="grid gap-0.5 text-[14px]">
            {read.items.map((it, i) => (
              <li key={`${it.name}-${i}`} className="[overflow-wrap:anywhere]">
                {it.name}
                <span className="ml-1.5 whitespace-nowrap font-mono font-bold text-v2-ink">× {it.qty}</span>
              </li>
            ))}
          </ul>
        )}
        {items ? (
          <div className="grid gap-1.5">
            <label className="flex min-w-0 items-center gap-2 text-xs text-v2-muted">
              <span className="w-28 shrink-0">Dishes start after:</span>
              <input
                className={cx(inputClass, 'h-8 flex-1 font-mono text-[12.5px]')}
                value={items.startAnchor}
                maxLength={120}
                onChange={(e) => onRules({ ...rules, items: { ...items, startAnchor: e.target.value } })}
              />
            </label>
            <label className="flex min-w-0 items-center gap-2 text-xs text-v2-muted">
              <span className="w-28 shrink-0">Dishes end before:</span>
              <input
                className={cx(inputClass, 'h-8 flex-1 font-mono text-[12.5px]')}
                value={items.endAnchor ?? ''}
                maxLength={120}
                placeholder="Tap a line in the email"
                onChange={(e) => onRules({ ...rules, items: { ...items, endAnchor: e.target.value || null } })}
              />
            </label>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

/* ── settings and results ───────────────────────────────────────────── */

function SenderChips({ senders, onChange }: { senders: string[]; onChange: (s: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = () => {
    const entry = normaliseSenderEntry(draft)
    if (!entry) return setError('Enter an email address like orders@zoop.in, or a whole domain like @zoop.in.')
    setError(null)
    setDraft('')
    if (!senders.includes(entry)) onChange([...senders, entry])
  }
  return (
    <div className="grid gap-2">
      <span className="text-[12.5px] font-semibold text-v2-ink-2">Emails come from</span>
      {senders.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {senders.map((s) => (
            <li key={s} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-v2-surface-2 py-0.5 pl-2.5 pr-1 font-mono text-xs text-v2-ink ring-1 ring-inset ring-v2-line">
              <span className="truncate">{s}</span>
              <button
                type="button"
                aria-label={`Remove ${s}`}
                title="Remove"
                onClick={() => onChange(senders.filter((x) => x !== s))}
                className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-v2-muted hover:bg-v2-sunken hover:text-v2-ink', v2Focus)}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-v2-warn">Needed: only mail from these addresses is read with this layout.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="layout-sender" className="sr-only">
          Sender email address
        </label>
        <input
          id="layout-sender"
          type="text"
          inputMode="email"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="orders@zoop.in or @zoop.in"
          className={cx(inputClass, 'h-9 w-full font-mono text-[13px] sm:w-80')}
        />
        <Button size="sm" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-v2-bad">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function TestResults({ rows, hasSenders }: { rows: TestRow[]; hasSenders: boolean }) {
  const good = rows.filter((r) => r.ok).length
  return (
    <div className="grid gap-2">
      <p className="text-sm">
        <Chip tone={good === rows.length ? 'ok' : 'warn'}>
          {good} of {rows.length} read
        </Chip>
        {rows.length === 1 && hasSenders ? <span className="ml-2 text-v2-muted">No other recent mail from these senders.</span> : null}
      </p>
      <TableFrame>
        <Table>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th align="center">Read</Th>
              <Th>Order number</Th>
              <Th>Dishes</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="group/row">
                <Td className="max-w-[16rem] truncate">{r.subject || r.from || 'Email'}</Td>
                <Td align="center">
                  {r.ok ? <Check size={16} className="inline text-v2-ok" aria-label="Read" /> : <X size={16} className="inline text-v2-bad" aria-label="Not read" />}
                </Td>
                <Td>{r.order ? <Mono>{r.order.externalOrderId}</Mono> : <span className="text-v2-faint">—</span>}</Td>
                <Td className="max-w-[18rem] truncate">{r.order?.items.join(', ') || <span className="text-v2-faint">—</span>}</Td>
                <Td className="text-v2-muted">{r.detail}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableFrame>
    </div>
  )
}
