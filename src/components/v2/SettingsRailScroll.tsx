'use client'

import { useEffect } from 'react'

/**
 * On a phone the Settings rail is a horizontal pill row, so a tab past the
 * third starts off-screen. This centres the active pill once on mount; the
 * row itself stays server-rendered.
 */
export function SettingsRailScroll({ navId }: { navId: string }) {
  useEffect(() => {
    const nav = document.getElementById(navId)
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2)
  }, [navId])
  return null
}
