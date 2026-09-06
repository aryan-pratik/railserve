'use client'

import { useNavPending } from './navPending'

/**
 * A 2px bar along the top of the content area while a navigation is pending.
 *
 * Always mounted and toggled by opacity, so it never shifts layout, and drawn
 * with a transform animation only. Not a spinner in the middle of the page:
 * the old content stays readable underneath, which is the whole point of a
 * client-side transition.
 */
export function TopProgress() {
  const pending = useNavPending()
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden transition-opacity duration-150 ${
        pending ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="h-full w-1/3 bg-accent motion-safe:animate-progress motion-reduce:w-full" />
    </div>
  )
}
