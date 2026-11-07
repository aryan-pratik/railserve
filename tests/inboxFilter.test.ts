import { describe, expect, it } from 'vitest'
import {
  inboxFilterParams,
  inboxQuery,
  isFiltered,
  previewOf,
  readInboxFilter,
  splitSender,
} from '../src/lib/inbox'

/** The admin inbox's filters: what the URL says, and the query it becomes. */
describe('inbox filters', () => {
  it('reads the page params and ignores what it does not recognise', () => {
    const f = readInboxFilter({
      show: 'resolved',
      reason: 'UNKNOWN_OUTLET',
      source: 'ZOOP',
      sender: ' Orders@Zoop.in ',
      q: '  1000585333 ',
      from: '2026-11-07',
      to: '2026-11-01',
    })
    expect(f).toEqual({
      resolved: true,
      reason: 'UNKNOWN_OUTLET',
      source: 'ZOOP',
      sender: 'orders@zoop.in',
      q: '1000585333',
      // A range picked backwards is read the right way round.
      from: '2026-11-01',
      to: '2026-11-07',
    })
    const junk = readInboxFilter({ reason: 'DROP TABLE', from: 'yesterday', show: 'everything' })
    expect(junk.reason).toBeNull()
    expect(junk.from).toBeNull()
    expect(junk.resolved).toBe(false)
    expect(isFiltered(junk)).toBe(false)
  })

  it('round-trips through the URL, so "all matching" acts on what the screen showed', () => {
    const f = readInboxFilter({ reason: 'PARSE_FAILED', q: 'zoop', from: '2026-11-01' })
    const back = readInboxFilter(new URLSearchParams(inboxFilterParams(f).toString()))
    expect(back).toEqual(f)
    expect(inboxQuery(back)).toEqual(inboxQuery(f))
  })

  it('builds the query: tab always, reason unless omitted, text escaped', () => {
    expect(inboxQuery(readInboxFilter({}))).toEqual({ resolved: false })

    const f = readInboxFilter({ reason: 'MISSING_FIELD', q: '#a.b(c' })
    const q = inboxQuery(f) as { $and: Record<string, unknown>[] }
    expect(q.$and[0]).toEqual({ resolved: false })
    expect(q.$and[1]).toEqual({ reason: 'MISSING_FIELD' })
    const text = q.$and[2].$or as { externalOrderId?: { $regex: string } }[]
    // The leading # of an order id is dropped; regex metacharacters are literal.
    expect(text.find((c) => c.externalOrderId)?.externalOrderId?.$regex).toBe('a\\.b\\(c')

    const noReason = inboxQuery(f, 'reason') as { $and: Record<string, unknown>[] }
    expect(noReason.$and.some((c) => 'reason' in c)).toBe(false)
  })

  it('bounds dates by IST day', () => {
    const q = inboxQuery(readInboxFilter({ from: '2026-11-07', to: '2026-11-07' })) as {
      $and: { createdAt?: { $gte: Date; $lt: Date } }[]
    }
    const range = q.$and[1].createdAt!
    expect(range.$gte.toISOString()).toBe('2026-11-06T18:30:00.000Z')
    expect(range.$lt.toISOString()).toBe('2026-11-07T18:30:00.000Z')
  })

  it('previews a body as one readable line', () => {
    expect(previewOf('<html><head><style>p{color:red}</style></head><body><p>Order&nbsp;#12 from <b>Zoop</b></p></body></html>'))
      .toBe('Order #12 from Zoop')
    expect(previewOf('*Order From YatriRestro*\n-----------\nOutlet Name- X')).toBe('*Order From YatriRestro* Outlet Name- X')
    expect(previewOf('x'.repeat(500), 20)).toHaveLength(20)
    expect(previewOf(null)).toBe('')
  })

  it('splits a From header into a name and an address', () => {
    expect(splitSender('"Zoop Orders" <Orders@Zoop.in>')).toEqual({ name: 'Zoop Orders', address: 'orders@zoop.in' })
    expect(splitSender('noreply@x.in')).toEqual({ name: '', address: 'noreply@x.in' })
    expect(splitSender(null)).toEqual({ name: '', address: '' })
  })
})
