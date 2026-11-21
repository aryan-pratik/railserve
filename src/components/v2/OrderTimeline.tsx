import { Chip, cx, statusChip } from './ui'
import { formatIST } from '@/lib/format'
import type { JourneyEntry } from '@/lib/v2/orderWorkspace'

/**
 * The order's journey as a vertical rail of sentences: who did what, when,
 * and why when a reason was given. `compact` is the right-rail version,
 * which keeps only the status moves and the last few lines.
 */
export function OrderTimeline({ entries, compact = false, className }: { entries: JourneyEntry[]; compact?: boolean; className?: string }) {
  const shown = compact ? entries.filter((e) => e.toStatus !== null).slice(-5) : entries
  if (shown.length === 0) {
    return <p className={cx('text-sm text-v2-muted', className)}>Nothing has happened to this order yet.</p>
  }
  const hidden = entries.length - shown.length
  return (
    <ol className={cx('relative grid gap-0', className)}>
      {hidden > 0 ? <li className="pb-2 pl-7 text-xs text-v2-faint">{hidden} earlier {hidden === 1 ? 'entry' : 'entries'} in History</li> : null}
      {shown.map((e, i) => {
        const last = i === shown.length - 1
        const chip = e.toStatus ? statusChip(e.toStatus) : null
        return (
          <li key={`${e.at}-${i}`} className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
            <span className="relative flex justify-center">
              {!last ? <span aria-hidden className="absolute top-3 bottom-[-4px] w-px bg-v2-line" /> : null}
              <span
                aria-hidden
                className={cx(
                  'relative z-10 mt-[7px] h-2.5 w-2.5 rounded-full ring-4 ring-v2-surface',
                  e.toStatus ? (last ? 'bg-v2-brand' : 'bg-v2-brand-deep') : 'bg-v2-line-strong',
                )}
              />
            </span>
            <div className={cx('min-w-0', last ? 'pb-0' : compact ? 'pb-3' : 'pb-4')}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={cx('font-semibold', compact ? 'text-[13px]' : 'text-sm')}>{e.title}</span>
                {chip && !compact ? <Chip tone={chip.tone}>{chip.label}</Chip> : null}
              </div>
              <div className="font-mono text-xs tabular-nums text-v2-faint">{formatIST(e.at)}</div>
              {!compact && e.detail ? <p className="mt-0.5 text-xs text-v2-ink-2">{e.detail}</p> : null}
              {e.reason ? <p className={cx('mt-0.5 text-xs text-v2-muted', compact && 'truncate')}>&ldquo;{e.reason}&rdquo;</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
