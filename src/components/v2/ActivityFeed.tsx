import Link from 'next/link'
import { ArrowRight, Cpu } from 'lucide-react'
import { PANEL_LABEL } from '@/lib/activity'
import type { ActivityEntry } from '@/lib/repo/activityRepo'
import { formatServiceDate, formatTimeIST, todayIST } from '@/lib/format'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { describeEntry } from '@/lib/v2/activity'
import { Avatar, Chip, Mono, cx, statusChip } from './ui'

/**
 * The feed: one row per thing someone did to an order, newest first. Who,
 * then what as a sentence, the order it was done to, the time, the station.
 * Grouped under a heading per IST day when the range spans more than one.
 */
export function ActivityFeed({ rows, names }: { rows: ActivityEntry[]; names: Map<string, string> }) {
  const days: { day: string; rows: ActivityEntry[] }[] = []
  for (const row of rows) {
    const day = todayIST(row.at)
    const last = days[days.length - 1]
    if (last?.day === day) last.rows.push(row)
    else days.push({ day, rows: [row] })
  }
  const showDays = days.length > 1

  return (
    <div className="grid">
      {days.map((group) => (
        <section key={group.day} aria-label={formatServiceDate(group.day)}>
          {showDays ? (
            <h3 className="sticky top-0 z-10 border-b border-v2-line bg-v2-surface-2 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-v2-muted">
              {formatServiceDate(group.day)}
            </h3>
          ) : null}
          <ol>
            {group.rows.map((row) => (
              <Row key={row.id} row={row} names={names} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function Row({ row, names }: { row: ActivityEntry; names: Map<string, string> }) {
  const s = describeEntry(row, names)
  const who = row.actor?.name ?? 'System'
  const role = row.actor ? (ROLE_LABEL[row.actor.role as Role] ?? row.actor.role) : null
  return (
    <li className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-v2-line px-3.5 py-3 text-sm last:border-b-0 sm:grid-cols-[36px_minmax(0,1fr)_auto]">
      {row.actor ? (
        <Avatar name={who} size={36} />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-full bg-v2-surface-2 text-v2-muted" aria-hidden>
          <Cpu size={16} strokeWidth={1.8} />
        </span>
      )}

      <div className="min-w-0">
        <p className="leading-snug [overflow-wrap:anywhere]">
          <b className="font-bold">{who}</b>
          {role ? <span className="text-v2-faint"> · {role}</span> : null} <span className="text-v2-ink-2">{s.verb}</span>
          {s.move ? (
            <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
              {s.move.from ? (
                <>
                  <Chip tone={statusChip(s.move.from).tone}>{statusChip(s.move.from).label}</Chip>
                  <ArrowRight size={13} className="text-v2-faint" aria-hidden />
                </>
              ) : null}
              <Chip tone={statusChip(s.move.to).tone}>{statusChip(s.move.to).label}</Chip>
            </span>
          ) : null}
        </p>
        {s.change ? (
          <p className="mt-0.5 text-[13px] text-v2-muted">
            {s.change.label}: <span className="line-through decoration-v2-faint/60">{s.change.from}</span>
            <span className="text-v2-faint"> → </span>
            <span className="text-v2-ink">{s.change.to}</span>
          </p>
        ) : null}
        {s.detail ? <p className="mt-0.5 text-[13px] text-v2-muted">{s.detail}</p> : null}
        {row.text ? (
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-v2-ink [overflow-wrap:anywhere]">
            &ldquo;{row.text}&rdquo;
            {row.editedAt ? <span className="text-v2-faint"> · edited</span> : null}
          </p>
        ) : null}
        {s.reason ? <p className="mt-0.5 text-[13px] text-v2-muted">&ldquo;{s.reason}&rdquo;</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-v2-muted">
          <Link href={`/v2/orders/${row.orderId}`} className="font-mono font-semibold text-v2-brand hover:underline">
            {row.externalOrderId}
          </Link>
          {row.trainNo ? <Mono>{row.trainNo}</Mono> : null}
          {row.contactName ? <span className="truncate">{row.contactName}</span> : null}
        </p>
      </div>

      <div className={cx('col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-3 sm:flex-col sm:items-end')}>
        <Mono className="text-xs text-v2-muted">{formatTimeIST(row.at)}</Mono>
        <span className="flex gap-1.5">
          <Chip tone="grey">{row.stationCode}</Chip>
          <Chip tone="grey">{PANEL_LABEL[row.panel]}</Chip>
        </span>
      </div>
    </li>
  )
}
