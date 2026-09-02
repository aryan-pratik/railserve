import { formatIST } from '@/lib/format'
import type { TrainFeedHealth } from '@/lib/train/service'

/**
 * Says what the arrival times on this board actually are.
 *
 * A board with no banner is claiming live data. Each state below means it is
 * not live, and the differences matter operationally: simulated times are safe
 * to demo against and meaningless to dispatch against; a feed that is entirely
 * down means real trains are moving and nobody here can see any of them; and
 * one train with no data means everything else on the board is still true.
 *
 * The last of those used to be reported as the second — "Live train feed is
 * down" over a feed that was answering fine for every other train — which
 * spends the operator's trust on a false alarm and teaches them to ignore the
 * banner that will one day be real.
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

  const lastGood = health.lastSuccessAt
    ? ` Last good reading ${formatIST(health.lastSuccessAt)}.`
    : ''

  // Everything is failing: this is the key, the quota or the vendor, and it is
  // the whole board that cannot be trusted.
  if (health.failingTrains.length >= health.trainsTried) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200">
        <strong>Live train feed is down</strong> — showing scheduled times, which do not account
        for delays. {health.message}
        {lastGood}
      </p>
    )
  }

  // Some trains are fine. Name the ones that are not, because the operator's
  // next question is always "which of these times can I act on".
  const trains = health.failingTrains
  const list = trains.length === 1 ? trains[0] : `${trains.slice(0, -1).join(', ')} and ${trains.at(-1)}`

  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
      <strong>
        No live status for {trains.length === 1 ? 'train' : 'trains'} {list}
      </strong>{' '}
      — {trains.length === 1 ? 'that run is' : 'those runs are'} on scheduled times, which do not
      account for delays. The rest of this board is live. {health.message}
      {lastGood}
    </p>
  )
}
