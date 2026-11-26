'use client'

import type { KitchenRun as KitchenRunData } from '@/lib/v2/kitchenView'
import { KitchenRun } from './KitchenRun'
import { useUrgencyOrder } from './useUrgencyOrder'

/** The kitchen's trains, in v1's urgency order on the strips' own clock. */
export function KitchenRunList({
  runs,
  riders,
  serverNowMs,
  delayThresholdMinutes,
  showOutlet,
}: {
  runs: KitchenRunData[]
  riders: { id: string; name: string }[]
  serverNowMs: number
  delayThresholdMinutes: number
  showOutlet: boolean
}) {
  const ordered = useUrgencyOrder(runs, (r) => r.etaIso, serverNowMs)
  return (
    <div className="grid gap-5">
      {ordered.map((run) => (
        <KitchenRun key={run.key} run={run} riders={riders} serverNowMs={serverNowMs} delayThresholdMinutes={delayThresholdMinutes} showOutlet={showOutlet} />
      ))}
    </div>
  )
}
