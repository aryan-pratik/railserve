'use client'

import type { ComponentProps } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useNavTransition } from './navPending'

/**
 * A filter form that navigates client-side instead of reloading the page.
 *
 * `<form method="get">` does a full document load: the shell repaints from
 * blank, every client component remounts, and the live feeds reconnect. That
 * is the "slow page" people feel when they change a filter. This reads the
 * same fields, builds the same query string, and pushes it through the
 * router inside a transition, so the current screen stays put with a
 * progress bar until the new one is ready.
 *
 * Empty values are dropped from the URL so a cleared field does not leave
 * `?train=&outlet=` behind, and so the page's own defaults apply again.
 *
 * Selects that should apply on change call `requestSubmit()` on the form;
 * that lands here too, so there is one path for both.
 */
export function QueryForm({
  action,
  onSubmit,
  children,
  ...props
}: Omit<ComponentProps<'form'>, 'action' | 'method'> & {
  /** Path to navigate to. Defaults to the current pathname. */
  action?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useNavTransition()

  function handleSubmit(e: Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0]) {
    onSubmit?.(e)
    if (e.defaultPrevented) return
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const params = new URLSearchParams()
    for (const [key, value] of data.entries()) {
      if (typeof value !== 'string') continue
      const v = value.trim()
      if (v) params.append(key, v)
    }
    const query = params.toString()
    const target = `${action ?? pathname}${query ? `?${query}` : ''}`
    start(() => router.push(target, { scroll: false }))
  }

  return (
    <form {...props} method="get" action={action} onSubmit={handleSubmit} aria-busy={pending || undefined}>
      {children}
    </form>
  )
}
