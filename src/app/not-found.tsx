import Link from 'next/link'

/** A wrong or stale link, most often an order that has been deleted. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-xl border border-dashed border-line-strong bg-surface p-8 text-center">
        <p className="font-medium text-ink">There is nothing at this address</p>
        <p className="mt-1 text-sm text-muted text-pretty">
          The link may be out of date, or the order it pointed at may have been removed.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Go to your board
        </Link>
      </div>
    </main>
  )
}
