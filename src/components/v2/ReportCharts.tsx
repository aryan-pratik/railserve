import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cx, v2Focus } from './ui'

/*
 * The few chart shapes Reports needs, drawn in plain HTML so they follow the
 * theme in light and dark. One colour (the brand green) for magnitude, a
 * single hue scale for the busy-times grid, values in ink never in the mark's
 * colour, the largest value labelled and the rest on hover and focus, and
 * every figure also readable as text beside or below the chart.
 */

/** "The brand green at n%": a step on the one-hue scale, mixed with the surface so dark mode works too. */
const brandStep = (pct: number) => `color-mix(in oklab, var(--color-v2-brand) ${pct}%, var(--color-v2-surface))`

/* ── a number with its change ──────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  change,
  goodWhen = 'up',
  note,
  hero = false,
}: {
  label: string
  value: string
  /** Percent against the earlier period; null when there is nothing to compare. */
  change?: number | null
  goodWhen?: 'up' | 'down'
  note?: ReactNode
  hero?: boolean
}) {
  const dir = change == null || change === 0 ? 0 : change > 0 ? 1 : -1
  const good = dir === 0 ? null : (dir > 0) === (goodWhen === 'up')
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus
  return (
    <div className={cx('grid min-w-0 content-start gap-2 rounded-v2-lg border p-3.5 sm:p-[18px]', hero ? 'border-v2-brand-deep bg-v2-brand-deep text-white' : 'border-v2-line bg-v2-surface')}>
      <span className={cx('text-[14px] font-semibold', hero ? 'text-white/85' : 'text-v2-ink-2')}>{label}</span>
      <span className={cx('font-bold leading-none tracking-[-0.03em]', hero ? 'text-[34px] sm:text-[40px]' : 'text-[24px] sm:text-[30px]')}>{value}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        {change != null ? (
          <span
            className={cx(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold',
              hero ? 'bg-white/15 text-white' : good === null ? 'bg-v2-surface-2 text-v2-muted' : good ? 'bg-v2-ok-bg text-v2-ok' : 'bg-v2-bad-bg text-v2-bad',
            )}
          >
            <Icon size={13} aria-hidden />
            {dir === 0 ? 'same' : `${Math.abs(change)}%`}
          </span>
        ) : null}
        {note ? <span className={hero ? 'text-v2-mint' : 'text-v2-muted'}>{note}</span> : null}
      </span>
    </div>
  )
}

/* ── columns over time ─────────────────────────────────────────────────── */

export type Column = { key: string; label: string; value: number; tip: string; sub?: string }

/**
 * One series of columns: sales per day or per hour. Columns at most 24px wide
 * with rounded tops, three quiet gridlines, the tallest one labelled, and each
 * column's value on hover or focus.
 */
export function ColumnChart({ rows, format, emptyNote = 'Nothing in these dates.', labelEvery }: { rows: Column[]; format: (v: number) => string; emptyNote?: string; labelEvery?: number }) {
  const max = Math.max(0, ...rows.map((r) => r.value))
  if (max === 0) return <p className="py-10 text-center text-sm text-v2-muted">{emptyNote}</p>
  const top = niceCeil(max)
  const every = labelEvery ?? Math.max(1, Math.ceil(rows.length / 12))
  const peak = rows.findIndex((r) => r.value === max)
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 pt-6">
      <div className="relative h-52 w-16 text-right font-mono text-[11px] tabular-nums text-v2-muted">
        {[1, 0.5, 0].map((f) => (
          <span key={f} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - f) * 100}%` }}>
            {format(top * f)}
          </span>
        ))}
      </div>
      <div className="relative h-52">
        {[0, 0.5, 1].map((f) => (
          <span key={f} aria-hidden className="absolute inset-x-0 h-px bg-v2-line" style={{ top: `${f * 100}%` }} />
        ))}
        <ol className="absolute inset-0 flex items-end gap-[2px]" aria-label="Chart">
          {rows.map((r, i) => (
            <li key={r.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center" tabIndex={0} aria-label={r.tip}>
              <span
                className="w-full max-w-[24px] rounded-t-[4px] bg-v2-brand transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                style={{ height: `${r.value > 0 ? Math.max(2, (r.value / top) * 100) : 0}%` }}
              />
              {i === peak ? (
                <span className="pointer-events-none absolute -translate-y-1 whitespace-nowrap font-mono text-[11px] font-bold text-v2-ink" style={{ bottom: `${(r.value / top) * 100}%` }}>
                  {format(r.value)}
                </span>
              ) : null}
              <Tip>
                <b className="block font-mono text-[13px]">{format(r.value)}</b>
                <span className="block">{r.tip}</span>
                {r.sub ? <span className="block text-white/70">{r.sub}</span> : null}
              </Tip>
            </li>
          ))}
        </ol>
      </div>
      <span />
      <div className="mt-1.5 flex gap-[2px] text-[11px] text-v2-muted">
        {rows.map((r, i) => (
          <span key={r.key} className="min-w-0 flex-1 truncate text-center">
            {i % every === 0 ? r.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function niceCeil(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/** A small dark label that shows on hover and keyboard focus. Its text is also elsewhere on the page. */
function Tip({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-[220px] -translate-x-1/2 rounded-v2-sm bg-v2-ink px-2.5 py-1.5 text-left text-[12px] leading-snug text-v2-bg shadow-v2-pop group-hover:block group-focus-visible:block">
      {children}
    </span>
  )
}

/* ── ranked bars ───────────────────────────────────────────────────────── */

export type RankRow = { key: string; label: ReactNode; value: number; valueText: string; sub?: ReactNode; aside?: ReactNode; href?: string }

/** Largest first, one hue, the figure at each bar's end. For dishes, aggregators, trains. */
export function RankBars({ rows, max: maxIn }: { rows: RankRow[]; max?: number }) {
  const max = maxIn ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="grid gap-1">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="min-w-0">
              <span className="block truncate text-[14.5px] font-semibold">{r.label}</span>
              {r.sub ? <span className="block truncate text-[12.5px] text-v2-muted">{r.sub}</span> : null}
            </span>
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-v2-surface-2">
                <span className="block h-full rounded-full bg-v2-brand" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
              </span>
              <span className="w-[4.5rem] shrink-0 text-right font-mono text-[13.5px] font-bold tabular-nums">{r.valueText}</span>
            </span>
            {r.aside !== undefined ? <span className="text-right text-[12.5px]">{r.aside}</span> : null}
          </>
        )
        const grid = cx('grid items-center gap-x-4 gap-y-1 rounded-v2-md px-2.5 py-2', r.aside !== undefined ? 'grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_4.5rem]' : 'grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]')
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} scroll={false} className={cx(grid, 'transition-colors hover:bg-v2-surface-2', v2Focus)}>
                {inner}
              </Link>
            ) : (
              <div className={grid}>{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ── busy times ────────────────────────────────────────────────────────── */

/** Weekdays down, hours across, darker = busier. Only the hours with any orders are drawn. */
export function HeatGrid({ grid, rowLabels, hourLabel }: { grid: number[][]; rowLabels: readonly string[]; hourLabel: (h: number) => string }) {
  const max = Math.max(0, ...grid.flat())
  const used = Array.from({ length: 24 }, (_, h) => grid.some((row) => row[h] > 0))
  const first = used.indexOf(true)
  const last = used.lastIndexOf(true)
  if (max === 0 || first < 0) return <p className="py-10 text-center text-sm text-v2-muted">No orders in these dates.</p>
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const step = (n: number) => (n === 0 ? 'var(--color-v2-surface-2)' : brandStep([18, 34, 52, 72, 92][Math.min(4, Math.floor((n / max) * 5 - 1e-9))]))
  const dark = (n: number) => n > 0 && n / max > 0.55
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="border-separate border-spacing-[3px] text-[11px]">
        <thead>
          <tr>
            <th />
            {hours.map((h) => (
              <th key={h} className="px-0.5 font-medium text-v2-muted">
                {h % 2 === first % 2 ? hourLabel(h).replace(' ', '') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, w) => (
            <tr key={w}>
              <th className="pr-2 text-right font-semibold text-v2-ink-2">{rowLabels[w]}</th>
              {hours.map((h) => (
                <td key={h} className="group relative p-0" tabIndex={row[h] ? 0 : -1} aria-label={`${rowLabels[w]} ${hourLabel(h)}: ${row[h]} orders`}>
                  <span
                    className={cx('grid size-8 place-items-center rounded-[5px] font-mono text-[11px] font-semibold tabular-nums', dark(row[h]) ? 'text-white' : 'text-v2-ink-2')}
                    style={{ background: step(row[h]) }}
                  >
                    {row[h] || ''}
                  </span>
                  {row[h] ? (
                    <Tip>
                      <b className="block">{row[h]} order{row[h] === 1 ? '' : 's'}</b>
                      {rowLabels[w]}, {hourLabel(h)}–{hourLabel(h + 1)}
                    </Tip>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-v2-muted">
        <span>Quiet</span>
        {[18, 34, 52, 72, 92].map((p) => (
          <span key={p} className="size-3.5 rounded-[3px]" style={{ background: brandStep(p) }} />
        ))}
        <span>Busy</span>
      </div>
    </div>
  )
}

/* ── two parts of one whole ────────────────────────────────────────────── */

/** A thin bar split in two, with the names and figures beside it. */
export function SplitBar({ parts }: { parts: { label: string; value: number; valueText: string; tone: 'brand' | 'soft' }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  return (
    <div className="grid gap-2.5">
      <span className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-v2-surface-2">
        {total > 0
          ? parts.map((p) =>
              p.value > 0 ? <span key={p.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.tone === 'brand' ? 'var(--color-v2-brand)' : brandStep(38) }} /> : null,
            )
          : null}
      </span>
      <span className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: p.tone === 'brand' ? 'var(--color-v2-brand)' : brandStep(38) }} />
            <span className="text-v2-ink-2">{p.label}</span>
            <b className="font-mono tabular-nums">{p.valueText}</b>
            <span className="text-v2-muted">{total ? `${Math.round((p.value / total) * 100)}%` : ''}</span>
          </span>
        ))}
      </span>
    </div>
  )
}
