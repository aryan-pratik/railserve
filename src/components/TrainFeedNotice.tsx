import { formatIST } from '@/lib/format'
import type { TrainFeedHealth } from '@/lib/train/service'

/**
 * Says what the arrival times on this board actually are.
 *
 * A board with no banner is claiming live data. Both of these states mean it is
 * not live, and the difference matters operationally: simulated times are safe
 * to demo against and meaningless to dispatch against, while a failing feed
 * means real trains are moving and nobody here can see it.
 */
export function TrainFeedNotice({
  simulated,
  health,
}: {
  simulated: boolean
  health: TrainFeedHealth
}) {
  if (simulated) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
        Train times are <strong>simulated</strong> — set <code className="font-mono">TRAIN_API_KEY</code>{' '}
        and <code className="font-mono">TRAIN_API_PROVIDER=rapidapi</code> for live status.
      </p>
    )
  }

  if (!health.failing) return null

  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200">
      <strong>Live train feed is down</strong> — showing scheduled times, which do not account for
      delays. {health.message}
      {health.lastSuccessAt ? ` Last good reading ${formatIST(health.lastSuccessAt)}.` : ''}
    </p>
  )
}
