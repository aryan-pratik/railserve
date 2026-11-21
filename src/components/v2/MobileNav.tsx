'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { SidebarNav, type V2NavSection } from './SidebarNav'
import { cx, v2Focus } from './ui'

/**
 * The sidebar as a drawer, for widths under `lg` where the shell hides it.
 * Closes on navigation and on Escape; the page behind cannot scroll while it
 * is open.
 */
export function MobileNav({ sections, footer }: { sections: V2NavSection[]; footer?: React.ReactNode }) {
  const pathname = usePathname()
  // Keyed by pathname: a navigation remounts the drawer state closed, with no effect needed.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className={cx('grid h-10 w-10 place-items-center rounded-full border border-v2-line text-v2-ink-2 lg:hidden', v2Focus)}
      >
        <Menu size={18} strokeWidth={1.8} aria-hidden />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-v2-ink/40" />
          <div className="absolute inset-y-0 left-0 grid w-[280px] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden bg-v2-surface py-[18px] shadow-v2-pop">
            <div className="flex items-center justify-between px-5">
              <span className="text-[19px] font-extrabold tracking-[-0.02em]">RailServe</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className={cx('grid h-9 w-9 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2', v2Focus)}
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto [overscroll-behavior:contain]">
              <SidebarNav sections={sections} />
            </div>
            <div className="grid gap-3 px-3.5">{footer}</div>
          </div>
        </div>
      ) : null}
    </>
  )
}
