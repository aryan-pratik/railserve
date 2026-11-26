'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { CountdownBand } from './Countdown'
import { RunHeader, type RunHeaderProps } from './RunHeader'
import { cx } from './ui'

/**
 * One train, grouped: the countdown band down the whole left edge, the train
 * and its arrival across the top, and its orders as a table underneath. Tap
 * the header to fold the orders away. The same card on the kitchen board
 * and in Orders grouped by train.
 */
export function TrainCard({
  header,
  open,
  onToggle,
  bodyId,
  actions,
  children,
  label,
  id,
}: {
  header: Omit<RunHeaderProps, 'fold' | 'actions' | 'bare' | 'className' | 'href'>
  open: boolean
  onToggle: () => void
  bodyId: string
  actions?: ReactNode
  children: ReactNode
  label?: string
  /** The card's anchor, so a link can jump to this train. */
  id?: string
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className="grid grid-cols-[64px_minmax(0,1fr)] overflow-hidden rounded-v2-xl border border-v2-line bg-v2-surface shadow-[0_1px_2px_rgba(16,24,20,0.04),0_10px_28px_-16px_rgba(16,24,20,0.18)] sm:grid-cols-[88px_minmax(0,1fr)] scroll-mt-4 target:ring-2 target:ring-v2-brand target:ring-offset-4 target:ring-offset-v2-surface"
    >
      <CountdownBand targetIso={header.etaIso} arrived={header.arrived} serverNowMs={header.serverNowMs} size="lg" className="min-h-full" />
      <div className="min-w-0">
        <RunHeader
          {...header}
          bare
          fold={{ open, onToggle, controls: bodyId }}
          actions={
            <span className="flex items-center gap-0.5">
              {actions}
              <span aria-hidden className={cx('grid size-8 place-items-center text-v2-muted transition-transform', open ? 'rotate-180' : '')}>
                <ChevronDown size={18} />
              </span>
            </span>
          }
        />
        <div id={bodyId} hidden={!open} className="border-t border-v2-line">
          {children}
        </div>
      </div>
    </section>
  )
}
