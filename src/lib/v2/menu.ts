import type { MenuRow } from '@/lib/repo/menuRepo'
import { MENU_CATEGORIES, menuCategory } from '@/lib/menuCategory'
import { ORDER_SOURCES } from '@/lib/orderEnums'

/*
 * The v2 Menu page's filters and ordering. Pure: the page reads the whole
 * menu from menuRepo.menuOverview, narrows and pages it here, and renders.
 */

export const MENU_TAGS = ['all', 'check', 'untagged', 'VEG', 'NON_VEG'] as const
export type MenuTag = (typeof MENU_TAGS)[number]

export const MENU_TAG_LABEL: Record<MenuTag, string> = {
  all: 'All',
  check: 'Needs a check',
  untagged: 'Not tagged',
  VEG: 'Veg',
  NON_VEG: 'Non-veg',
}

export type MenuFilters = { source: string; section: string; tag: MenuTag; q: string }

type Params = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** Reads the filters from the URL; anything unknown falls back to "all". */
export function readMenuFilters(sp: Params): MenuFilters {
  const source = one(sp.source)
  const section = one(sp.section)
  const tag = one(sp.tag) as MenuTag
  return {
    source: (ORDER_SOURCES as readonly string[]).includes(source) ? source : '',
    section: MENU_CATEGORIES.includes(section) ? section : '',
    tag: MENU_TAGS.includes(tag) ? tag : 'all',
    q: one(sp.q).trim().slice(0, 80),
  }
}

/** A tag that is only a suggestion still needs a person; so does no tag at all. */
export const needsCheck = (r: MenuRow) => r.diet === null || !r.reviewed

export function matchesTag(r: MenuRow, tag: MenuTag): boolean {
  if (tag === 'all') return true
  if (tag === 'check') return needsCheck(r)
  if (tag === 'untagged') return r.diet === null
  return r.diet === tag
}

export function menuCounts(rows: MenuRow[]): Record<MenuTag, number> {
  return {
    all: rows.length,
    check: rows.filter(needsCheck).length,
    untagged: rows.filter((r) => r.diet === null).length,
    VEG: rows.filter((r) => r.diet === 'VEG').length,
    NON_VEG: rows.filter((r) => r.diet === 'NON_VEG').length,
  }
}

/**
 * The menu in reading order: section by section as a printed menu goes, and
 * in each section veg first, then non-veg, then untagged, most ordered first.
 */
export function sortMenu(rows: MenuRow[]): MenuRow[] {
  const rank = new Map(MENU_CATEGORIES.map((c, i) => [c, i]))
  const section = new Map(rows.map((r) => [r.id, menuCategory(r.name)]))
  const dietRank = (r: MenuRow) => (r.diet === 'VEG' ? 0 : r.diet === 'NON_VEG' ? 1 : 2)
  return [...rows].sort(
    (a, b) =>
      (rank.get(section.get(a.id)!) ?? 99) - (rank.get(section.get(b.id)!) ?? 99) ||
      dietRank(a) - dietRank(b) ||
      b.orderCount - a.orderCount ||
      a.name.localeCompare(b.name),
  )
}

/** The page's URL for a change of filter or page; blank values are left out. */
export function menuHref(f: MenuFilters, over: Partial<MenuFilters> = {}, paging?: { page: number; pageSize: number }): string {
  const next = { ...f, ...over }
  const u = new URLSearchParams()
  if (next.source) u.set('source', next.source)
  if (next.section) u.set('section', next.section)
  if (next.tag !== 'all') u.set('tag', next.tag)
  if (next.q) u.set('q', next.q)
  if (paging) {
    if (paging.page > 1) u.set('page', String(paging.page))
    if (paging.pageSize !== 20) u.set('pageSize', String(paging.pageSize))
  }
  const qs = u.toString()
  return `/v2/menu${qs ? `?${qs}` : ''}`
}

export function hasMenuFilters(f: MenuFilters): boolean {
  return Boolean(f.source || f.section || f.tag !== 'all' || f.q)
}
