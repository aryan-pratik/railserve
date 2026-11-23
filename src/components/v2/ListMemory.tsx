'use client'

import { useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/*
 * The Kitchen and Orders lists keep their day, tab and filters in the
 * address. Going into an order and back used to land on the plain list
 * (today, no filters). The list remembers its full address here, per tab,
 * and the order page's back link returns to it.
 */

const KEY = 'rs.listUrl'

/** Rendered on a list page: remembers where the list was. */
export function RememberList() {
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, window.location.pathname + window.location.search)
    } catch {
      // Private mode: the back link falls back to the plain list.
    }
  })
  return null
}

/** "← Kitchen" / "← Orders": back to the list as it was left, else to `href`. */
export function BackToList({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter()
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        let saved: string | null = null
        try {
          saved = sessionStorage.getItem(KEY)
        } catch {
          saved = null
        }
        // Only a list of the same kind: never send someone somewhere unexpected.
        if (saved && saved.split('?')[0] === href.split('?')[0]) {
          e.preventDefault()
          router.push(saved)
        }
      }}
    >
      {children}
    </Link>
  )
}
