'use client'

import Link from 'next/link'
import { focusRing } from './ui'
import { LinkHint } from './LinkHint'

/**
 * Grouped by train, or one row per order. A link rather than a checkbox
 * because the choice lives in the URL, where a bookmark or a shared link
 * keeps it; the switch is only how it looks.
 */
export function GroupByTrainToggle({ href, isGrouped }: { href: string; isGrouped: boolean }) {
  return (
    <Link
      href={href}
      role="switch"
      aria-checked={isGrouped}
      className={`inline-flex h-7 items-center gap-2 rounded-lg px-1 text-xs font-medium text-ink ${focusRing}`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          isGrouped ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
            isGrouped ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className="whitespace-nowrap">Group by train</span>
      <LinkHint />
    </Link>
  )
}
