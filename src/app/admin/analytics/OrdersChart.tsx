'use client'

import { useState, type KeyboardEvent } from 'react'
import { OUTCOMES, OUTCOME_LABEL, niceCeil, type Bucket, type Outcome } from '@/lib/analytics'
import { OUTCOME_FILL } from './outcomeStyle'

/**
 * The screen's one chart: orders along the date range, each bar stacked by
 * outcome. It reads the same filtered rows as the tiles above and the table
 * below, so the three always agree.
 *
 * Drawn with flex boxes rather than an SVG of fixed geometry: bars share
 * whatever width the card has, so a month fits a phone and a laptop alike
 * with nothing to scroll sideways. A bar never grows past 24px; on a short
 * range the leftover width is left as air.
 *
 * Hover, tap or the arrow keys read one bar out in full. Every figure is
 * also in the "Day" table below, so nothing is reachable by pointer alone.
 */
export function OrdersChart({
  buckets, unit, heading, sub,
}: {
  buckets: Bucket[]
  unit: string
  /** The figure the chart adds up to, e.g. "128 orders". */
  heading: string
  /** What is plotted, e.g. "per day". */
  sub: string
}) {
  const [active, setActive] = useState<number | null>(null)

  const peak = Math.max(0, ...buckets.map((b) => b.total))
  const axisMax = niceCeil(peak)
  const ticks = [axisMax, axisMax / 2, 0]
  const present = OUTCOMES.filter((o) => buckets.some((b) => b.counts[o] > 0))
  const n = buckets.length

  // Axis labels collide long before bars do, so they are thinned: roughly
  // six on a phone-width card, fourteen on a wide one. The sparse set is a
  // subset of the dense one, so labels never jump when the card resizes.
  const dense = Math.max(1, Math.ceil(n / 14))
  const sparse = dense * Math.max(1, Math.ceil(n / 6 / dense))

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      setActive((i) => Math.min(n - 1, Math.max(0, (i ?? (step > 0 ? -1 : n)) + step)))
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  const shown = active !== null ? buckets[active] : null

  return (
    <div className="@container">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">{heading}</h2>
          <p className="text-xs text-muted">{sub}</p>
        </div>
        {/* One outcome needs no key: the line above already names it. */}
        {present.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
            {present.map((o) => (
              <li key={o} className="inline-flex items-center gap-1.5 text-xs text-muted">
                <span className="size-2 rounded-full" style={{ background: OUTCOME_FILL[o] }} aria-hidden />
                {OUTCOME_LABEL[o]}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-6 flex gap-2">
        {/* The value axis: three round numbers, aligned to their gridlines. */}
        <div className="relative h-48 w-7 shrink-0 @2xl:h-60" aria-hidden>
          {ticks.map((t, i) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-faint"
              style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            role="group"
            tabIndex={0}
            aria-label={`Orders per ${unit}, stacked by outcome. Use the left and right arrow keys to read each ${unit}.`}
            onKeyDown={onKeyDown}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            className="relative h-48 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 @2xl:h-60"
          >
            {ticks.map((t, i) => (
              <div
                key={t}
                aria-hidden
                className={`absolute inset-x-0 border-t ${t === 0 ? 'border-line-strong' : 'border-line/70'}`}
                style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
              />
            ))}

            <div className="absolute inset-0 flex">
              {buckets.map((b, i) => (
                // The whole column is the hit target, not just the painted bar.
                <div
                  key={b.key}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  className={`flex h-full min-w-0 flex-1 items-end justify-center px-px transition-opacity ${
                    active !== null && active !== i ? 'opacity-35' : ''
                  }`}
                >
                  {b.total > 0 ? (
                    <div
                      className="flex w-full max-w-6 flex-col-reverse gap-0.5"
                      style={{ height: `${(b.total / axisMax) * 100}%`, minHeight: 3 }}
                    >
                      {OUTCOMES.filter((o) => b.counts[o] > 0).map((o) => (
                        <div
                          key={o}
                          className="min-h-0.5 last:rounded-t"
                          style={{ flex: `${b.counts[o]} 1 0`, background: OUTCOME_FILL[o] }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {shown && active !== null ? <Readout bucket={shown} at={(active + 0.5) / n} /> : null}
          </div>

          <div className="mt-1.5 flex" aria-hidden>
            {buckets.map((b, i) => (
              <div key={b.key} className="relative h-4 min-w-0 flex-1">
                {i % dense === 0 ? (
                  <span
                    className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-faint ${
                      i % sparse === 0 ? '' : 'hidden @2xl:block'
                    }`}
                  >
                    {b.label}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The same reading for a screen reader, which cannot hover. */}
      <p className="sr-only" aria-live="polite">
        {shown ? `${shown.title}: ${shown.total} orders. ${describe(shown)}` : ''}
      </p>
    </div>
  )
}

function describe(b: Bucket): string {
  return OUTCOMES.filter((o) => b.counts[o] > 0)
    .map((o) => `${b.counts[o]} ${OUTCOME_LABEL[o].toLowerCase()}`)
    .join(', ')
}

/**
 * One bar read out: the value leads, the name follows. Pinned to the top of
 * the plot over its bar, and flipped to hang from its other edge past the
 * middle, so it never runs off the card on a phone.
 */
function Readout({ bucket, at }: { bucket: Bucket; at: number }) {
  const rows: Outcome[] = OUTCOMES.filter((o) => bucket.counts[o] > 0)
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-line bg-surface px-3 py-2 shadow-lg"
      style={at < 0.5 ? { left: `calc(${at * 100}% + 10px)` } : { right: `calc(${(1 - at) * 100}% + 10px)` }}
    >
      <div className="text-xs font-medium text-muted">{bucket.title}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink">
        {bucket.total} order{bucket.total === 1 ? '' : 's'}
      </div>
      {rows.length ? (
        <dl className="mt-1.5 space-y-1 border-t border-line pt-1.5">
          {rows.map((o) => (
            <div key={o} className="flex items-center gap-2 text-xs">
              <span className="h-0.5 w-3 rounded-full" style={{ background: OUTCOME_FILL[o] }} aria-hidden />
              <dt className="flex-1 text-muted">{OUTCOME_LABEL[o]}</dt>
              <dd className="font-semibold tabular-nums text-ink">{bucket.counts[o]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
