import type { RiderView } from '@/lib/repo/riderLocationRepo'
import { cx, v2Focus } from '@/components/v2/ui'

/*
 * Pure helpers for the Riders screens, safe to import from client components.
 * Nothing here may import a repo, a model or the database.
 */

export const BOARD_STATUS = ['ONLINE', 'ON_DELIVERY', 'IDLE', 'OFFLINE'] as const
export type BoardStatus = (typeof BOARD_STATUS)[number]

export const BOARD_STATUS_LABEL: Record<BoardStatus, string> = {
  ONLINE: 'Online',
  ON_DELIVERY: 'On delivery',
  IDLE: 'Idle',
  OFFLINE: 'Offline',
}

/**
 * Where a rider is, folded with what they are doing. Food in hand outranks
 * "online" and "idle" but not "offline": a rider gone quiet while carrying
 * orders is the row to look at, and the calm colour would hide it.
 */
export function boardStatusOf(rider: Pick<RiderView, 'presence' | 'work'> & { active?: boolean }): BoardStatus {
  if (rider.active === false) return 'OFFLINE'
  if (rider.presence === 'NEVER' || rider.presence === 'OFFLINE') return 'OFFLINE'
  if (rider.work.carrying > 0) return 'ON_DELIVERY'
  return rider.presence === 'LIVE' ? 'ONLINE' : 'IDLE'
}

/** The badge word, which says why someone is offline when it can. */
export function statusWordOf(rider: Pick<RiderView, 'presence' | 'work'> & { active?: boolean }): string {
  if (rider.active === false) return 'Inactive'
  if (rider.presence === 'NEVER') return 'Never shared'
  return BOARD_STATUS_LABEL[boardStatusOf(rider)]
}

/**
 * Marker and legend colours, from the v2 palette. Green is the brand's
 * "working"; blue for on-delivery because red here means a failed order and a
 * rider doing their job is not an alarm; two greys for the two kinds of quiet.
 */
export const STATUS_HEX: Record<BoardStatus, string> = {
  ONLINE: '#1f6b47',
  ON_DELIVERY: '#1f4fb3',
  IDLE: '#2f3a34',
  OFFLINE: '#98a19c',
}

export const STATUS_DOT: Record<BoardStatus, string> = {
  ONLINE: 'bg-v2-brand',
  ON_DELIVERY: 'bg-v2-info',
  IDLE: 'bg-v2-ink-2',
  OFFLINE: 'bg-v2-faint',
}

/** "98••• 44120": enough to recognise, not enough to dial from a screenshot. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return phone
  return `${digits.slice(0, 2)}••• ${digits.slice(-5)}`
}


/** Field styling shared by the rider dialogs and the detail page's filters. */
export const riderInputClass = cx(
  'h-10 w-full rounded-v2-md border border-v2-line-strong bg-v2-surface px-3 text-sm text-v2-ink placeholder:text-v2-faint disabled:bg-v2-surface-2 disabled:text-v2-muted',
  v2Focus,
)
