import { formatIST } from '@/lib/format'
import type { TrainFeedHealth } from '@/lib/train/service'
import { Notice } from './ui'

/**
 * Says what the arrival times on this board actually are.
 *
 * A board with no banner is claiming live data. Each state below means it is
 * not live, and the differences matter: simulated times are safe to demo
 * against and meaningless to dispatch against; a feed that is entirely down
 * means real trains are moving and nobody here can see any of them; and one
 * train with no data means everything else on the board is still true.
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
      <Notice tone="warn">
        Train times on this screen are <strong>simulated</strong>, not live. Do not dispatch against them.
      </Notice>
    )
  }

  if (!health.failing) return null

  // What the operator needs and nothing more: how much of the board is not
  // live, what those times are instead, and how old the last live reading
  // is. The provider's own error text ("timed out after 4000ms") is for
  // whoever fixes the feed: it stays on the TrainStatus row and comes back
  // from a train card's "Check now" button, not on every board.
  const lastGood = health.lastSuccessAt ? ` Last live reading ${formatIST(health.lastSuccessAt)}.` : ''

  // Everything is failing: the key, the quota or the vendor, and the whole
  // board cannot be trusted.
  if (health.failingTrains.length >= health.trainsTried) {
    return (
      <Notice tone="danger">
        <strong>Live train feed is down.</strong> Times are from the timetable.{lastGood}
      </Notice>
    )
  }

  // Some trains are fine. Name the ones that are not, because the operator's
  // next question is "which of these times can I act on". Past a handful the
  // list folds away, or it is a wall of numbers nobody reads.
  const trains = health.failingTrains
  const many = trains.length > 4
  const list = trains.length === 1 ? trains[0] : `${trains.slice(0, -1).join(', ')} and ${trains.at(-1)}`

  return (
    <Notice tone="warn">
      <strong>
        No live status for {trains.length} of {health.trainsTried} trains.
      </strong>{' '}
      Their times are from the timetable.{lastGood}
      {many ? (
        <details className="mt-1 text-xs font-normal">
          <summary className="cursor-pointer underline-offset-2 hover:underline">Which trains</summary>
          <span className="mt-1 block font-mono">{trains.join(', ')}</span>
        </details>
      ) : (
        <span className="mt-1 block font-mono text-xs font-normal">{list}</span>
      )}
    </Notice>
  )
}
