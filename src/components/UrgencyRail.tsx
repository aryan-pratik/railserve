'use client'

import { useNowMs } from './useNow'

/**
 * How long until this train arrives, as the largest thing on the card.
 *
 * This replaces a 4px coloured border. Two things were wrong with that: it was
 * hue-only, so the amber and green states are identical to a red-green
 * colour-blind reader and neither survives a printed board; and it was four
 * pixels, which is not something anyone reads from across a kitchen no matter
 * what colour it is. The signal a kitchen needs is a number of minutes, so the
 * rail carries the number and uses colour only to reinforce it.
 *
 * It ticks on its own clock, because the board is left open all shift and a
 * server-rendered countdown is wrong the moment it paints. `serverNow` seeds
 * the first render so the rail is correct before hydration rather than blank —
 * server and first client render agree on it, so there is no mismatch, and the
 * hook takes over from the next tick.
 */
const TICK_MS = 30_000

/**
 * Fill and text chosen together so every band clears WCAG AA (4.5:1) at any
 * size — measured against the real Tailwind v4 values, not assumed.
 *
 * The first version of this rail painted white on amber-500, which is 2.13:1.
 * That put the worst contrast on the board in its most-consulted state, the
 * 20-45 minute window where a kitchen decides what to start. Amber is an
 * inherently light fill, so it takes dark text (8.61:1); the darker reds and
 * greens take white. Mixing text colour per band is what maximises legibility,
 * and legibility is the entire job of this element.
 *
 * Urgent and overdue share a fill on purpose: they are distinguished by the
 * word NOW rather than by a hue step, which survives colour-blindness and a
 * monochrome printout.
 *
 * Past this, the train is not "arriving now" — it left. An order still sitting
 * open is a data problem or an abandoned job, and it must stop competing for
 * attention with the train that is actually at the platform.
 */
const STALE_AFTER_MINUTES = 90

function band(mins: number) {
  if (mins < -STALE_AFTER_MINUTES) return { bg: 'bg-line-strong', fg: 'text-ink' }
  if (mins <= 20) return { bg: 'bg-red-600', fg: 'text-white' }   // 4.77:1
  if (mins <= 45) return { bg: 'bg-amber-500', fg: 'text-ink' }   // 8.61:1
  return { bg: 'bg-emerald-700', fg: 'text-white' }               // 5.36:1
}

/** "45m", "2h 13m", "13h" — never "809m". */
function span(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (h < 10) return `${h}h ${m}m`
  return `${h}h`
}

export function UrgencyRail({ at, serverNow }: { at: string | null; serverNow: string }) {
  const ticked = useNowMs(TICK_MS)
  const now = ticked ?? Math.floor(new Date(serverNow).getTime() / TICK_MS) * TICK_MS

  // No arrival time is not "not urgent" — it is "unknown", and it must not read
  // as the calm end of the scale. Slate with a literal "?" says so.
  if (!at) {
    return (
      <div
        className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 self-stretch bg-line-strong px-1 py-3 text-ink"
        role="img"
        aria-label="Arrival time unknown"
      >
        <span className="text-xl font-bold leading-none">?</span>
        <span className="text-xs font-semibold uppercase leading-none">no eta</span>
      </div>
    )
  }

  const mins = Math.round((new Date(at).getTime() - now) / 60_000)
  const tone = band(mins)

  // A screen reader would otherwise hear "23, min" as the first content of
  // every card, ahead of the train number, with nothing saying 23 until what.
  const stale = mins < -STALE_AFTER_MINUTES
  const spoken = stale
    ? `Train left ${span(-mins)} ago — this order is still open`
    : mins === 0
      ? 'Train due now'
      : mins < 0
        ? `Train arrived ${span(-mins)} ago`
        : `Arrives in ${span(mins)}`

  // Long past its halt: stop shouting. This is a stale order to clean up, not
  // a delivery to run for.
  if (stale) {
    return (
      <div
        className={`flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 self-stretch px-1 py-3 ${tone.bg} ${tone.fg}`}
        role="img"
        aria-label={spoken}
      >
        <span className="text-base font-bold leading-none tabular-nums">{span(-mins)}</span>
        <span className="text-xs font-semibold uppercase leading-none">ago</span>
      </div>
    )
  }

  // Past its arrival time is the highest-stakes minute in the whole operation:
  // the train is standing at the platform now. It gets the loudest state on the
  // board, not the quietest.
  if (mins <= 0) {
    return (
      <div
        className={`flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 self-stretch px-1 py-3 ${tone.bg} ${tone.fg}`}
        role="img"
        aria-label={spoken}
      >
        <span className="text-base font-bold uppercase leading-none tracking-tight">now</span>
        <span className="text-xs font-semibold leading-none tabular-nums">
          {mins === 0 ? 'due' : `${span(-mins)} ago`}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 self-stretch px-1 py-3 ${tone.bg} ${tone.fg}`}
      role="img"
      aria-label={spoken}
    >
      <span className="text-xl font-bold leading-none tabular-nums">
        {mins >= 60 ? `${Math.floor(mins / 60)}h` : mins}
      </span>
      <span className="text-xs font-semibold uppercase leading-none tabular-nums">
        {mins >= 60 ? `${mins % 60}m` : 'min'}
      </span>
    </div>
  )
}
