import { formatIST } from '@/lib/format'
import { StatusBadge } from '@/components/ui'
import { IconArrowRight } from '@/components/Icons'
import { formatMoney } from '@/lib/format'
import { formatLoggedValue, itemField, orderField } from '@/lib/orderEditFields'

export type EventRow = {
  fromStatus: string | null
  toStatus: string
  actor: string
  meta: Record<string, unknown>
  createdAt: Date | string
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** "old → new", the old struck through so the eye lands on what it is now. */
function Change({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <>
      <span className="font-medium text-muted">{label}:</span>{' '}
      <span className="text-faint line-through decoration-faint/60">{from}</span>
      <span className="text-faint"> → </span>
      <span className="text-ink">{to}</span>
    </>
  )
}

/**
 * The line under an event saying what an edit changed, for the actions that
 * carry one. Null for everything else, which already reads from its badges.
 */
function changeDetail(meta: Record<string, unknown>, names?: Map<string, string>): React.ReactNode {
  switch (meta.action) {
    case 'FIELD_EDITED': {
      const def = orderField(String(meta.field))
      const label = def?.label ?? str(meta.label) ?? String(meta.field)
      return <Change label={label} from={formatLoggedValue(def, meta.from)} to={formatLoggedValue(def, meta.to)} />
    }
    case 'ITEM_EDITED': {
      const def = itemField(String(meta.field))
      const label = `${str(meta.item) ?? 'Item'} · ${(def?.label ?? str(meta.label) ?? String(meta.field)).toLowerCase()}`
      return <Change label={label} from={formatLoggedValue(def, meta.from)} to={formatLoggedValue(def, meta.to)} />
    }
    case 'ITEM_ADDED':
    case 'ITEM_REMOVED': {
      const price = typeof meta.pricePaise === 'number' ? ` · ${formatMoney(meta.pricePaise)}` : ''
      const packing = meta.isPacking ? ' (packing)' : ''
      return (
        <span className="text-ink">
          {meta.action === 'ITEM_ADDED' ? 'Added ' : 'Removed '}
          {str(meta.item) ?? 'an item'} ×{String(meta.qty ?? 1)}
          {price}
          {packing}
        </span>
      )
    }
    case 'ASSIGN_AGENTS':
    case 'ASSIGN_RIDERS': {
      if (!names || !Array.isArray(meta.agentIds)) return null
      const list = (ids: unknown) =>
        Array.isArray(ids) && ids.length > 0
          ? ids.map((id) => names.get(String(id)) ?? 'Unknown rider').join(', ')
          : 'nobody'
      // Older events did not record who had it before.
      if (!Array.isArray(meta.fromAgentIds)) {
        return <span className="text-ink">Riders: {list(meta.agentIds)}</span>
      }
      return <Change label="Riders" from={list(meta.fromAgentIds)} to={list(meta.agentIds)} />
    }
    default:
      return null
  }
}

/**
 * The audit trail. Events are embedded on the order because they are only
 * ever read alongside it; this renders them in the order they happened.
 *
 * `names` resolves rider ids on assignment events; without it those events
 * show only their badge, as before.
 */
export function EventLog({ events, names }: { events: EventRow[]; names?: Map<string, string> }) {
  if (events.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">No events yet.</p>
  }

  return (
    <ol className="divide-y divide-line">
      {events.map((e, i) => {
        const action = typeof e.meta?.action === 'string' ? e.meta.action : null
        const isSideEffect = e.fromStatus === e.toStatus
        // A telecaller has to give a reason to cancel (see /calls/actions).
        // It is recorded so somebody can read it back, which means showing it.
        const reason =
          typeof e.meta?.reason === 'string' && e.meta.reason.trim() ? e.meta.reason.trim() : null
        const detail = isSideEffect ? changeDetail(e.meta ?? {}, names) : null
        return (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <span className="w-32 shrink-0 text-xs tabular-nums text-faint">{formatIST(e.createdAt)}</span>

            {isSideEffect ? (
              <span className="rounded bg-sunken px-2 py-0.5 text-xs font-medium text-muted">
                {action === 'FIELD_EDITED' ? 'edited' : action ? action.replace(/_/g, ' ').toLowerCase() : 'updated'}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {e.fromStatus ? (
                  <>
                    <StatusBadge status={e.fromStatus} />
                    <IconArrowRight size={14} className="text-faint" aria-hidden />
                  </>
                ) : (
                  <span className="text-xs font-medium text-muted">created</span>
                )}
                <StatusBadge status={e.toStatus} />
              </span>
            )}

            <span className="ml-auto text-xs text-faint">{e.actor}</span>

            {detail ? (
              <p className="w-full whitespace-pre-wrap break-words pl-32 text-xs text-pretty">{detail}</p>
            ) : null}

            {reason ? (
              <p className="w-full pl-32 text-xs text-muted text-pretty">&ldquo;{reason}&rdquo;</p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
