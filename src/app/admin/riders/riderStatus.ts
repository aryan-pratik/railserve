import type { RiderView } from '@/lib/repo/riderLocationRepo'

/**
 * What the board calls a rider, folding where they are (presence) together
 * with what they are doing (carrying food).
 *
 * "On delivery" outranks "Online" and "Idle": a rider with food in hand is
 * the one the board is for, whether their phone sent a fix ten seconds ago or
 * three minutes ago. It does not outrank "Offline" — a rider who has gone
 * quiet for ten minutes while carrying orders is a problem, and painting them
 * the calm colour of work-in-progress would hide it. Their carrying count
 * still shows in the row.
 */
export const BOARD_STATUS = ['ONLINE', 'ON_DELIVERY', 'IDLE', 'OFFLINE'] as const
export type BoardStatus = (typeof BOARD_STATUS)[number]

export function boardStatusOf(rider: RiderView): BoardStatus {
  if (rider.presence === 'NEVER' || rider.presence === 'OFFLINE') return 'OFFLINE'
  if (rider.work.carrying > 0) return 'ON_DELIVERY'
  return rider.presence === 'LIVE' ? 'ONLINE' : 'IDLE'
}

export const BOARD_STATUS_LABEL: Record<BoardStatus, string> = {
  ONLINE: 'Online',
  ON_DELIVERY: 'On delivery',
  IDLE: 'Idle',
  OFFLINE: 'Offline',
}

/** A rider's own badge text: "Never shared" is still Offline, but says why. */
export function statusLabelOf(rider: RiderView): string {
  return rider.presence === 'NEVER' ? 'Never shared' : BOARD_STATUS_LABEL[boardStatusOf(rider)]
}

/**
 * One colour per status, used by the badge, the avatar, the legend and the
 * map marker alike, so the table and the map read as the same thing.
 *
 * Blue for on-delivery, not red: red on these screens means a failed or
 * refunded order, and a rider doing their job is not an alarm.
 */
export const STATUS_TONE: Record<
  BoardStatus,
  { hex: string; halo: string; badge: string; dot: string; avatar: string }
> = {
  ONLINE: {
    hex: '#059669',
    halo: 'rgba(5,150,105,0.22)',
    badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    dot: 'bg-emerald-500',
    avatar: 'bg-emerald-600',
  },
  ON_DELIVERY: {
    hex: '#2563eb',
    halo: 'rgba(37,99,235,0.22)',
    badge: 'bg-blue-50 text-blue-800 ring-blue-200',
    dot: 'bg-blue-600',
    avatar: 'bg-blue-600',
  },
  IDLE: {
    hex: '#d97706',
    halo: 'rgba(217,119,6,0.22)',
    badge: 'bg-amber-50 text-amber-900 ring-amber-200',
    dot: 'bg-amber-500',
    avatar: 'bg-amber-600',
  },
  OFFLINE: {
    hex: '#64748b',
    halo: 'rgba(100,116,139,0.20)',
    badge: 'bg-slate-100 text-slate-700 ring-slate-300',
    dot: 'bg-slate-400',
    avatar: 'bg-slate-500',
  },
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
