import Link from 'next/link'
import { formatServiceDate, formatTimeIST, todayIST } from '@/lib/format'
import { PANEL_LABEL, type ActivityPanel } from '@/lib/activity'
import type { ActivityEntry } from '@/lib/repo/activityRepo'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { EventBadges, eventDetail } from '@/components/EventLog'
import { focusRing } from '@/components/ui'

/**
 * One dot colour per screen. A dot rather than a filled chip: the log's
 * colour already belongs to the status badges in every row, and a second
 * set of loud fills would make neither readable.
 */
const PANEL_DOT: Record<ActivityPanel, string> = {
  ADMIN: 'bg-slate-700',
  CALLS: 'bg-sky-500',
  STORE: 'bg-violet-500',
  RIDER_APP: 'bg-blue-600',
  RIDER_WEB: 'bg-cyan-500',
  SYSTEM: 'bg-slate-300',
}

export function PanelChip({ panel }: { panel: ActivityPanel }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted ring-1 ring-line-strong ring-inset">
      <span aria-hidden className={`size-1.5 rounded-full ${PANEL_DOT[panel]}`} />
      {PANEL_LABEL[panel]}
    </span>
  )
}

/**
 * The activity log's rows: who did what, to which order, from which screen.
 *
 * Grouped under a heading per IST day, because a range of several days reads
 * as one undifferentiated column of times otherwise. `hideActor` is for a log
 * that is already one person's, where repeating their name on every row is
 * noise — the rider page uses it, and still shows who else acted.
 */
export function ActivityList({
  rows,
  names,
  emptyNote,
  actorId,
}: {
  rows: ActivityEntry[]
  names: Map<string, string>
  emptyNote: string
  /** Rows by this person drop their name; rows by anyone else keep it. */
  actorId?: string
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted text-pretty">{emptyNote}</p>
  }

  const days: { day: string; rows: ActivityEntry[] }[] = []
  for (const row of rows) {
    // The IST calendar day the entry falls on.
    const day = todayIST(row.at)
    const last = days[days.length - 1]
    if (last?.day === day) last.rows.push(row)
    else days.push({ day, rows: [row] })
  }

  return (
    <div>
      {days.map((group) => (
        <section key={group.day} aria-label={formatServiceDate(group.day)}>
          <h3 className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-4 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase backdrop-blur">
            {formatServiceDate(group.day)}
          </h3>
          <ol className="divide-y divide-line">
            {group.rows.map((row) => (
              <ActivityRow key={row.id} row={row} names={names} self={row.actor?.id === actorId} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function ActivityRow({ row, names, self }: { row: ActivityEntry; names: Map<string, string>; self: boolean }) {
  const { detail, reason } =
    row.type === 'event' ? eventDetail(row, names) : { detail: null, reason: null }
  const who = row.actor
    ? `${row.actor.name} · ${ROLE_LABEL[row.actor.role as Role] ?? row.actor.role}`
    : 'System'

  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <time
        dateTime={row.at.toISOString()}
        className="pt-0.5 text-xs whitespace-nowrap text-faint tabular-nums"
      >
        {formatTimeIST(row.at)}
      </time>

      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {row.type === 'note' ? (
            <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">call note</span>
          ) : (
            <EventBadges fromStatus={row.fromStatus} toStatus={row.toStatus} meta={row.meta} />
          )}
          <Link
            href={`/admin/orders/${row.orderId}`}
            className={`rounded font-mono text-xs font-medium text-accent hover:underline ${focusRing}`}
          >
            {row.externalOrderId}
          </Link>
          <span className="text-xs text-faint">
            {row.stationCode}
            {row.trainNo ? ` · ${row.trainNo}` : ''}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {self ? null : <span className="text-xs text-muted">{who}</span>}
            <PanelChip panel={row.panel} />
          </span>
        </div>

        {row.text ? (
          <p className="text-xs whitespace-pre-wrap break-words text-ink text-pretty">
            &ldquo;{row.text}&rdquo;
            {row.editedAt ? <span className="text-faint"> · edited</span> : null}
          </p>
        ) : null}
        {detail ? <p className="text-xs whitespace-pre-wrap break-words text-pretty">{detail}</p> : null}
        {reason ? <p className="text-xs text-muted text-pretty">&ldquo;{reason}&rdquo;</p> : null}
      </div>
    </li>
  )
}
