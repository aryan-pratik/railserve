import { useRef, type MouseEvent, type PointerEvent } from 'react'

/**
 * Press and hold (about half a second) to do something else than a tap:
 * here, to select an order instead of opening it. The tap that ends a hold
 * is swallowed so it does not also follow the row's link, and the phone's
 * own long-press menu is suppressed on the row.
 */
export function useLongPress(onLong: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  return {
    onPointerDown: (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('input,button,select')) return
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      cancel()
      timer.current = setTimeout(() => {
        fired.current = true
        onLong()
      }, ms)
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
  }
}
