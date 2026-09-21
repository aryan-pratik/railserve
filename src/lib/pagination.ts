import { PAGE_SIZE_OPTIONS } from '@/components/ui'

/** What every paginated list starts on. Matches /admin/orders and /admin/setup. */
export const DEFAULT_PAGE_SIZE = 20

type Params = Record<string, string | string[] | undefined>

/**
 * Reads `page` and `pageSize` off a server page's searchParams, the same way
 * every paginated list here does, so a hand-edited URL can never ask for page
 * zero or a page size the control doesn't offer.
 */
export function readPage(sp: Params): { page: number; pageSize: number; skip: number } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const pageParam = Number.parseInt(one(sp.page), 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const sizeParam = Number.parseInt(one(sp.pageSize), 10)
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(sizeParam)
    ? sizeParam
    : DEFAULT_PAGE_SIZE
  return { page, pageSize, skip: (page - 1) * pageSize }
}

/**
 * Adds page and page size to a query string, leaving both out at their
 * defaults so an ordinary link stays clean.
 */
export function withPage(
  params: URLSearchParams,
  target: { page: number; pageSize: number },
): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('page')
  next.delete('pageSize')
  if (target.page > 1) next.set('page', String(target.page))
  if (target.pageSize !== DEFAULT_PAGE_SIZE) next.set('pageSize', String(target.pageSize))
  return next
}
