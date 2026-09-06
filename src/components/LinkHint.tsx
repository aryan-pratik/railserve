'use client'

import { useLinkStatus } from 'next/link'
import { Spinner } from './Spinner'

/**
 * Inline "this link is loading" hint for a nav item or tab.
 *
 * Always rendered at a fixed size and toggled by opacity, so the label never
 * shifts when it appears. Skipped automatically when the route was already
 * prefetched, which is the case that needs no feedback anyway.
 */
export function LinkHint({ className = '' }: { className?: string }) {
  const { pending } = useLinkStatus()
  return (
    <span
      aria-hidden
      className={`inline-flex size-3.5 shrink-0 items-center justify-center transition-opacity duration-150 ${
        pending ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    >
      <Spinner size={14} />
    </span>
  )
}
