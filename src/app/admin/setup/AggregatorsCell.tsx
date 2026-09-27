import Link from 'next/link'
import { focusRing } from '@/components/ui'

/**
 * Which aggregators feed this kitchen, as a fold-out summary.
 *
 * Read-only on purpose. An outlet's row is where someone renames a kitchen or
 * retires it, and the aggregator mapping is a different decision with
 * different consequences — changing it re-routes live orders. So this says
 * what feeds the kitchen and links to the screen that can change it, rather
 * than offering a control that looks incidental next to "Walk: 10 min".
 *
 * A native `<details>` rather than a popover: it needs no JavaScript, it is
 * keyboard-operable for free, and a row that is open stays open through the
 * page's own re-renders.
 */
export function AggregatorsCell({
  listings,
}: {
  /** Storefronts routed to this outlet, plus the ones arriving via the station default. */
  listings: { name: string; source: string | null; viaDefault: boolean }[]
}) {
  if (listings.length === 0) {
    return <span className="text-xs text-faint">Direct only</span>
  }

  // The aggregator is the useful summary: "who sends us orders here". Several
  // storefronts can share one, so it is deduplicated.
  const sources = [...new Set(listings.map((l) => l.source).filter(Boolean))] as string[]

  return (
    <details className="group">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-muted hover:text-ink ${focusRing}`}
      >
        <span className="tabular-nums">
          {listings.length} storefront{listings.length === 1 ? '' : 's'}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden className="transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <ul className="mt-1.5 space-y-1">
        {listings.map((l) => (
          <li key={`${l.name}-${l.source ?? ''}`} className="text-xs">
            <span className="text-ink [overflow-wrap:anywhere]">{l.name}</span>
            {l.source ? <span className="ml-1 font-mono text-faint">{l.source}</span> : null}
            {l.viaDefault ? (
              // Worth distinguishing: this one is not mapped, it simply lands
              // here because it is the station's default. Someone should decide.
              <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-800">
                unmapped
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <Link
        href="/admin/setup?tab=aggregators"
        className={`mt-1.5 inline-block rounded text-xs font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}
      >
        Change routing
      </Link>

      {sources.length > 0 ? (
        <p className="sr-only">Aggregators: {sources.join(', ')}</p>
      ) : null}
    </details>
  )
}
