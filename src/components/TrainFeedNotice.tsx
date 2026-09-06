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

  const lastGood = health.lastSuccessAt ? ` Last good reading ${formatIST(health.lastSuccessAt)}.` : ''
  const detail = health.message ? (
    <span className="mt-1 block text-xs font-normal opacity-80">Provider said: {health.message}</span>
  ) : null

  // Everything is failing: the key, the quota or the vendor, and the whole
  // board cannot be trusted.
  if (health.failingTrains.length >= health.trainsTried) {
    return (
      <Notice tone="danger">
        <strong>Live train feed is down.</strong> Showing timetable times, which do not account for
        delays.{lastGood}
        {detail}
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
      Those runs show timetable times, which do not account for delays. The rest of this board is
      live.{lastGood}
      {many ? (
        <details className="mt-1 text-xs font-normal">
          <summary className="cursor-pointer underline-offset-2 hover:underline">Which trains</summary>
          <span className="mt-1 block font-mono">{trains.join(', ')}</span>
        </details>
      ) : (
        <span className="mt-1 block font-mono text-xs font-normal">{list}</span>
      )}
      {detail}
    </Notice>
  )
}
