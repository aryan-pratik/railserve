import { SettingsTrainLookup } from '@/components/v2/SettingsTrainLookup'
import { todayIST } from '@/lib/format'
import type { loadSetupBase } from '@/lib/v2/settings'

type Base = Awaited<ReturnType<typeof loadSetupBase>>

/**
 * Ask about any train, not just one somebody ordered from. Admin-only because
 * each lookup spends a request against the train API plan; the answer lands
 * in the same cache row the boards read, so it also warms them.
 */
export function TrainsTab({ base, now }: { base: Base; now: Date }) {
  return <SettingsTrainLookup stations={base.stations.map((s) => ({ code: s.code, name: s.name }))} today={todayIST(now)} />
}
