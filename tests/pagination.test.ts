import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, readPage, withPage } from '../src/lib/pagination'

/** Every paginated list reads its page off the URL through these two. */
describe('pagination helpers', () => {
  it('defaults to page one at the default size', () => {
    expect(readPage({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, skip: 0 })
  })

  it('skips whole pages', () => {
    expect(readPage({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50, skip: 100 })
  })

  it('refuses a hand-edited URL: page zero, garbage, or a size the control does not offer', () => {
    expect(readPage({ page: '0' }).page).toBe(1)
    expect(readPage({ page: '-4' }).page).toBe(1)
    expect(readPage({ page: 'abc' }).page).toBe(1)
    expect(readPage({ pageSize: '7' }).pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(readPage({ pageSize: '100000' }).pageSize).toBe(DEFAULT_PAGE_SIZE)
  })

  it('keeps other filters and leaves defaults out of the URL', () => {
    const base = new URLSearchParams({ tab: 'yesterday', q: '12398' })
    expect(withPage(base, { page: 1, pageSize: DEFAULT_PAGE_SIZE }).toString()).toBe('tab=yesterday&q=12398')
    expect(withPage(base, { page: 2, pageSize: 50 }).toString()).toBe('tab=yesterday&q=12398&page=2&pageSize=50')
  })

  it('replaces an old page rather than stacking a second one', () => {
    const base = new URLSearchParams({ page: '4', pageSize: '10' })
    expect(withPage(base, { page: 2, pageSize: 10 }).toString()).toBe('page=2&pageSize=10')
  })
})
