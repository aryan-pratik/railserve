import Link from 'next/link'
import { OUTCOMES, type Bucket, type Outcome } from '@/lib/analytics'
import { OUTCOME_SWATCH, OUTCOME_WORD } from '@/lib/v2/analytics'
import { cx } from './ui'

/**
 * Orders along the date range as the v2 pill bars: delivered solid at the
 * foot, in progress above it, and what never reached the passenger hatched
 * on top. One bar per day, week or month, every one a link to that span.
 * Server-rendered divs only; the figures are also in the Day breakdown, so
 * nothing here is the only way to read a number.
 */
export function AnalyticsChart({
  buckets,
  unit,
  selectedKey,
  hrefFor,
}: {
  buckets: Bucket[]
  unit: 'day' | 'week' | 'month'
  /** The bucket drawn in the deep brand: today, or the one day in view. */
  selectedKey: string | null
  hrefFor: (bucket: Bucket) => string
}) {
  const n = buckets.length
  const peak = Math.max(1, ...buckets.map((b) => b.total))
  const peakIndex = buckets.findIndex((b) => b.total === peak && peak > 0)
  const present = OUTCOMES.filter((o) => buckets.some((b) => b.counts[o] > 0))
  // Axis labels collide long before bars do: about one in fourteen on a wide
  // card, one in five on a phone.
  const step = Math.max(1, Math.ceil(n / 14))
  const phoneStep = Math.max(1, Math.ceil(n / 5))
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }

  return (
    <div className="grid gap-2">
      <div className="grid h-[180px] items-end gap-1 pt-7 sm:gap-2" style={cols}>
        {buckets.map((b, i) => {
          // To scale against the busiest bucket; a few pixels keep a lone order visible.
          const height = `max(6px, ${((b.total / peak) * 100).toFixed(1)}%)`
          const selected = b.key === selectedKey
          const parts = OUTCOMES.filter((o) => b.counts[o] > 0)
          const title = `${b.title} · ${b.total} order${b.total === 1 ? '' : 's'}${parts.length ? ` · ${parts.map((o) => `${b.counts[o]} ${OUTCOME_WORD[o].toLowerCase()}`).join(', ')}` : ''}`
          return (
            <Link
              key={b.key}
              href={hrefFor(b)}
              scroll={false}
              title={title}
              aria-label={title}
              className="group relative flex h-full min-w-0 items-end justify-center rounded-full"
            >
              {b.total === 0 ? (
                <span className="block h-2 w-full max-w-7 rounded-full bg-v2-sunken" aria-hidden />
              ) : (
                <span
                  className={cx('flex w-full max-w-7 flex-col-reverse overflow-hidden rounded-full ring-2 ring-transparent transition-shadow group-hover:ring-v2-mint', selected && 'ring-v2-brand-deep/30')}
                  style={{ height }}
                  aria-hidden
                >
                  {parts.map((o) => (
                    <span key={o} className={cx('block min-h-[3px]', swatch(o, selected))} style={{ flex: `${b.counts[o]} 1 0` }} />
                  ))}
                </span>
              )}
              {i === peakIndex ? (
                <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-v2-line bg-v2-surface-2 px-1.5 font-mono text-[11px] text-v2-ink-2">
                  {b.label} · {b.total}
                </span>
              ) : null}
            </Link>
          )
        })}
      </div>
      <div className="grid gap-1 text-center font-mono text-[11px] text-v2-muted sm:gap-2" style={cols} aria-hidden>
        {buckets.map((b, i) => (
          <span key={b.key} className={cx('overflow-visible whitespace-nowrap', i % step !== 0 && 'invisible', i % phoneStep !== 0 && 'max-sm:invisible')}>
            {unit === 'day' ? b.label.split(' ')[0] : b.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3.5 text-[12.5px] text-v2-ink-2">
        {present.map((o) => (
          <span key={o} className="inline-flex items-center gap-1.5">
            <span className={cx('inline-block h-3 w-3 rounded-full', OUTCOME_SWATCH[o])} aria-hidden />
            {OUTCOME_WORD[o]}
          </span>
        ))}
        {selectedKey && buckets.some((b) => b.key === selectedKey && b.total > 0) ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-v2-brand-deep" aria-hidden />
            {buckets.some((b) => b.key === selectedKey && b.counts.delivered > 0) ? 'Today' : 'Today (nothing delivered yet)'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** The selected bar's delivered segment goes deep brand, like the dashboard's current hour. */
function swatch(o: Outcome, selected: boolean): string {
  if (o === 'delivered' && selected) return 'bg-v2-brand-deep'
  return OUTCOME_SWATCH[o]
}
