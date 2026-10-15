function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-sunken motion-safe:animate-pulse ${className}`} />
}

/**
 * The riders board's own shape — figures, then map beside roster — rather
 * than the section's table skeleton, so nothing moves when the board lands.
 */
export default function Loading() {
  return (
    <div className="@container/board space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="space-y-2">
        <Bar className="h-7 w-32" />
        <Bar className="h-4 w-full max-w-md" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 ${i === 0 ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <Bar className="size-10 rounded-lg" />
            <div className="space-y-1.5">
              <Bar className="h-3 w-20" />
              <Bar className="h-6 w-16" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 @[60rem]/board:min-h-[24rem] @[60rem]/board:grid-cols-[minmax(18rem,4fr)_minmax(0,9fr)] @[60rem]/board:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <div className="px-4 py-3">
            <Bar className="h-4 w-40" />
          </div>
          <div className="h-80 bg-sunken motion-safe:animate-pulse sm:h-[26rem] @[60rem]/board:h-auto @[60rem]/board:min-h-0 @[60rem]/board:flex-1" />
          <div className="px-4 py-3">
            <Bar className="h-3 w-64" />
          </div>
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-line bg-surface">
          <div className="space-y-3 p-4">
            <Bar className="h-8 w-full max-w-lg" />
            <Bar className="h-9 w-full" />
          </div>
          <div className="divide-y divide-line border-t border-line">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Bar className="size-9 rounded-full" />
                <Bar className="h-4 flex-1" />
                <Bar className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
