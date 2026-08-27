import { formatIST } from '@/lib/format'
import { StatusBadge } from '@/components/ui'

export type EventRow = {
  fromStatus: string | null
  toStatus: string
  actor: string
  meta: Record<string, unknown>
  createdAt: Date | string
}

/**
 * The audit trail. Plan §3 keeps events embedded on the order because they are
 * only ever read alongside it — this renders them in the order they happened.
 */
export function EventLog({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return <p className="px-4 py-6 text-sm text-slate-500">No events yet.</p>
  }

  return (
    <ol className="divide-y divide-slate-100">
      {events.map((e, i) => {
        const action = typeof e.meta?.action === 'string' ? e.meta.action : null
        const isSideEffect = e.fromStatus === e.toStatus
        return (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <span className="w-32 shrink-0 text-xs tabular-nums text-slate-400">
              {formatIST(e.createdAt)}
            </span>

            {isSideEffect ? (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {action ? action.replace(/_/g, ' ').toLowerCase() : 'updated'}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {e.fromStatus ? (
                  <>
                    <StatusBadge status={e.fromStatus} />
                    <span className="text-slate-400">→</span>
                  </>
                ) : (
                  <span className="text-xs font-medium text-slate-500">created</span>
                )}
                <StatusBadge status={e.toStatus} />
              </span>
            )}

            <span className="ml-auto text-xs text-slate-500">{e.actor}</span>
          </li>
        )
      })}
    </ol>
  )
}
