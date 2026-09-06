/**
 * Instant feedback while a route's data is still on the wire.
 *
 * Every page in this app is a server component that awaits Mongo before it
 * renders, and App Router holds the *old* page on screen until that resolves.
 * With no loading state, tapping a nav item on a slow connection looks like
 * the tap was missed, so people tap again. A skeleton costs nothing and
 * converts that dead time into visible progress.
 *
 * Shapes rather than a spinner: matching the layout that is about to arrive
 * keeps the page from jumping when the real content lands.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-sunken motion-safe:animate-pulse ${className}`} />
}

/** Header, a filter strip, and a table. The shape of nearly every screen here. */
export function PageSkeleton({
  rows = 8,
  stats = 0,
}: {
  rows?: number
  /** Number of summary tiles above the table, if this screen has them. */
  stats?: number
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="space-y-2">
        <Bar className="h-7 w-40" />
        <Bar className="h-4 w-full max-w-md" />
      </div>

      {stats > 0 ? (
        <div className="grid gap-3 rounded-xl border border-line bg-surface p-1 sm:grid-cols-3">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="space-y-2 px-5 py-4">
              <Bar className="h-3 w-24" />
              <Bar className="h-7 w-32" />
              <Bar className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Bar className="h-9 w-full max-w-xs" />
        <Bar className="h-9 w-64" />
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line bg-sunken/60 px-4 py-3">
          <Bar className="h-3 w-32 bg-line" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Bar className="h-4 flex-1" />
              <Bar className="hidden h-4 w-28 sm:block" />
              <Bar className="hidden h-4 w-24 md:block" />
              <Bar className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
