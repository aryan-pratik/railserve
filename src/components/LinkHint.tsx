'use client'

import { useLinkStatus } from 'next/link'
import { Spinner } from './Spinner'

/**
 * Inline "this link is loading" hint for a nav item or tab.
 *
 * Always rendered at a fixed size and toggled by opacity, so the label never
 * shifts when it appears. Pass `tucked` inside a link with at least 12px of
 * right padding (a tab, a segment). Skipped automatically when the route was already
 * prefetched, which is the case that needs no feedback anyway.
 */
export function LinkHint({ className = '', tucked = false }: { className?: string; tucked?: boolean }) {
  const { pending } = useLinkStatus()
  return (
    <span
      aria-hidden
      // Tucked: the spinner sits in the link's own right padding instead of
      // adding 20px of blank width after the label. In a row of tabs that
      // blank width is what pushed the controls beside them onto a second line.
      className={`inline-flex size-3.5 shrink-0 items-center justify-center transition-opacity duration-150 ${
        pending ? 'opacity-100' : 'opacity-0'
      } ${tucked ? '-ml-1 -mr-2.5' : ''} ${className}`}
    >
      <Spinner size={14} />
    </span>
  )
}
