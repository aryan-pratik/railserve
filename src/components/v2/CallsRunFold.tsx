'use client'

import type { ReactNode } from 'react'
import { RunHeader, type RunHeaderProps } from './RunHeader'
import { RunFoldButton, useRunFold } from './KitchenBits'

/**
 * One train on the call board: the departure strip with the fold chevron in
 * its actions, and the passenger rows under it. Open by default (or by the
 * page's choice when every passenger is already called); a fold is remembered
 * for the tab, so the board's refresh does not reopen what was put away.
 */
export function CallsRunFold({
  runKey,
  header,
  chips,
  defaultOpen = true,
  children,
}: {
  runKey: string
  header: Omit<RunHeaderProps, 'actions' | 'href' | 'className'>
  /** Chips beside the chevron: "All called", "3 to call". */
  chips?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useRunFold('calls', runKey, defaultOpen)
  const rowsId = `calls-run-${runKey}-rows`
  return (
    <section data-run className="grid min-w-0 gap-2" aria-label={`${header.trainLabel} ${header.trainName ?? ''}`}>
      <RunHeader
        {...header}
        actions={
          <>
            {chips}
            <RunFoldButton open={open} onToggle={() => setOpen(!open)} controls={rowsId} />
          </>
        }
      />
      <div id={rowsId} hidden={!open} className="min-w-0">
        {children}
      </div>
    </section>
  )
}
