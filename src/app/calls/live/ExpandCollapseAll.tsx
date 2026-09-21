'use client'

import { Button } from '@/components/ui'

/**
 * Opens or folds every train on the board at once.
 *
 * Each train is a native <details>, whose open state lives in the DOM, so this
 * sets it there directly rather than mirroring 30 booleans into React state.
 * React only rewrites `open` when a train's own default changes, so what is set
 * here survives the board's periodic refresh.
 */
export function ExpandCollapseAll({ targetId }: { targetId: string }) {
  const setAll = (open: boolean) => {
    document
      .querySelectorAll<HTMLDetailsElement>(`#${targetId} details[data-train-section]`)
      .forEach((d) => {
        d.open = open
      })
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" className="min-h-11 sm:min-h-9" onClick={() => setAll(true)}>
        Expand all
      </Button>
      <Button type="button" variant="secondary" className="min-h-11 sm:min-h-9" onClick={() => setAll(false)}>
        Collapse all
      </Button>
    </div>
  )
}
