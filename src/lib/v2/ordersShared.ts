/*
 * Pure helpers for the Orders screens, safe to import from client components.
 * Nothing here may import a repo, a model or the database.
 */

import { v2Focus } from '@/components/v2/ui'

/**
 * One input style for the whole Orders filter bar: a pill, like the buttons.
 * Lives here, not in a 'use client' file: a server component that imports a
 * string from a client module gets a client reference instead of the string,
 * and the class silently vanishes.
 */
export const ordersFieldClass = `h-10 w-full min-w-0 rounded-full border border-v2-line bg-v2-surface px-3.5 text-sm text-v2-ink placeholder:text-v2-faint disabled:opacity-50 ${v2Focus}`

/** Mirrors runRepo.LIVE_STATUSES; copied so client components can import this file without pulling mongoose. */
export const LIVE_STATUS_LIST = ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED'] as const
const LIVE = new Set<string>(LIVE_STATUS_LIST)

export function isLive(status: string): boolean {
  return LIVE.has(status)
}

/** The five squares on a RunHeader, from a run's orders. */
export function runCounts(statuses: string[]) {
  const n = (pred: (s: string) => boolean) => statuses.filter(pred).length
  return {
    fresh: n((s) => s === 'RECEIVED'),
    cooking: n((s) => s === 'ACCEPTED' || s === 'KOT_PRINTED'),
    ready: n((s) => s === 'PREPARED'),
    out: n((s) => s === 'DISPATCHED'),
    closed: n((s) => !LIVE.has(s)),
  }
}

/** "98••• 44120": enough to recognise a number, not enough to dial it from a list. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return '•••'
  return `${digits.slice(0, 2)}••• ${digits.slice(-5)}`
}

/** What the four bulk actions move: one status in, one status out. */
export const BULK_ACTIONS = {
  accept: { from: 'RECEIVED', label: 'Accept' },
  ready: { from: 'KOT_PRINTED', label: 'Mark ready' },
  hand: { from: 'PREPARED', label: 'Hand to rider' },
  kot: { from: 'ACCEPTED', label: 'Print KOTs' },
} as const
export type BulkKind = keyof typeof BULK_ACTIONS

/** `runKey|orderId`, the one value a bulk form carries per order. '~' is the run key's own separator, so '|' is safe. */
export function bulkPick(runKey: string, orderId: string): string {
  return `${runKey}|${orderId}`
}

export function parseBulkPick(value: string): { runKey: string; orderId: string } | null {
  const i = value.lastIndexOf('|')
  if (i <= 0 || i === value.length - 1) return null
  return { runKey: value.slice(0, i), orderId: value.slice(i + 1) }
}
