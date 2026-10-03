'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** One order's id and status, which is all the run actions need to count. */
export type SelectableOrder = { id: string; status: string }

type RunSelectionValue = {
  orders: SelectableOrder[]
  selected: ReadonlySet<string>
  toggle: (id: string) => void
  setAll: (on: boolean) => void
  clear: () => void
}

const RunSelectionContext = createContext<RunSelectionValue | null>(null)

/**
 * Which orders on one train the manager has ticked.
 *
 * A train is not always one trip: half its orders can be ready while the rest
 * are still on the stove, and five orders down a long rake can need two
 * riders. Ticking rows narrows the run's actions to those orders; ticking
 * nothing keeps the old whole-train behaviour.
 *
 * A context rather than props because the ticks live in the rows and the
 * buttons live in the card's footer, and the board between them is a server
 * component that cannot hand a callback from one to the other.
 */
export function RunSelection({ orders, children }: { orders: SelectableOrder[]; children: ReactNode }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())

  // After a refresh an order can leave the run (delivered, cancelled); a tick
  // on a row that is no longer there must not keep counting.
  const selected = useMemo(() => {
    const ids = new Set(orders.map((o) => o.id))
    return new Set([...picked].filter((id) => ids.has(id)))
  }, [orders, picked])

  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const setAll = useCallback(
    (on: boolean) => setPicked(on ? new Set(orders.map((o) => o.id)) : new Set()),
    [orders],
  )
  const clear = useCallback(() => setPicked(new Set()), [])

  const value = useMemo(
    () => ({ orders, selected, toggle, setAll, clear }),
    [orders, selected, toggle, setAll, clear],
  )
  return <RunSelectionContext.Provider value={value}>{children}</RunSelectionContext.Provider>
}

/** The surrounding train's selection, or null where rows are not selectable. */
export function useRunSelection(): RunSelectionValue | null {
  return useContext(RunSelectionContext)
}
