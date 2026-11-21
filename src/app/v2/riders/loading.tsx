function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded-v2-md bg-v2-sunken motion-safe:animate-pulse ${className}`} />
}

/** The board's own shape, so nothing moves when it lands. */
export default function Loading() {
  return (
    <div className="grid gap-[18px]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="grid gap-2">
        <Bar className="h-9 w-40" />
        <Bar className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="grid gap-3 rounded-v2-lg border border-v2-line bg-v2-surface p-[18px]">
            <Bar className="h-4 w-24" />
            <Bar className="h-9 w-20" />
            <Bar className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface">
          <div className="px-[18px] py-3.5">
            <Bar className="h-5 w-32" />
          </div>
          <div className="h-[380px] bg-v2-sunken motion-safe:animate-pulse xl:h-[560px]" />
        </div>
        <div className="grid content-start gap-3.5 rounded-v2-lg border border-v2-line bg-v2-surface p-[18px]">
          <Bar className="h-5 w-24" />
          <Bar className="h-9 w-full max-w-md" />
          <Bar className="h-10 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bar className="h-9 w-9 rounded-full" />
              <Bar className="h-4 flex-1" />
              <Bar className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
