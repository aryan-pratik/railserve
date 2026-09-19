import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Printing is routed by station, not by outlet. A Restaurant is an aggregator
 * brand; a station is the kitchen with the printer in it. Three brands at
 * Kanpur Central share one stove, one printer and one agent, so a run that
 * spans all three must produce exactly ONE job.
 */

// Keeps puppeteer and sharp out of the module graph — same reasoning as
// appOrigin.test.ts. One PNG per requested ticket, which is what the real
// render page produces now that it is told which orders to draw.
const renderKotScreenshots = vi.fn(async (url: string) => {
  const wanted = new URL(url).searchParams.get('orders')
  const count = wanted ? wanted.split(',').length : 1
  return Array.from({ length: count }, (_, i) => Buffer.from(`png-${i}`))
})
vi.mock('@/lib/printer/screenshot', () => ({ renderKotScreenshots }))

const { enqueueOrderKotPrint, enqueueRunKotPrint } = await import('../src/lib/printer/queue')
const { PrintJob } = await import('../src/lib/models')
const { resetDb, makeRestaurant } = await import('./fixtures')

const ORIGIN = 'https://bitestation.elvo.in'

beforeEach(async () => {
  await resetDb()
  renderKotScreenshots.mockClear()
})

describe('enqueueRunKotPrint', () => {
  it('queues ONE job for a run spanning three brands at one station', async () => {
    // The whole point of the station migration. Under the old per-outlet
    // fan-out this produced three jobs needing three agents on one printer.
    const orderIds = ['aaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaa2', 'aaaaaaaaaaaaaaaaaaaaaaa3']
    await enqueueRunKotPrint({ appOrigin: ORIGIN, runKey: '12487~2026-09-19~CNB', orderIds })

    const jobs = await PrintJob.find({})
    expect(jobs).toHaveLength(1)
    expect(jobs[0].stationCode).toBe('CNB')
    expect(jobs[0].images).toHaveLength(3)
    // A run spans brands, so there is no single outlet to attribute it to.
    expect(jobs[0].restaurantId).toBeNull()
    expect(jobs[0].refId).toBe('12487~2026-09-19~CNB')
  })

  it('renders only the orders the caller is entitled to print', async () => {
    // The internal render page runs under an ADMIN-shaped context that
    // bypasses outlet scoping, so without this the run would print every
    // brand's tickets to a manager who holds one of them.
    await enqueueRunKotPrint({
      appOrigin: ORIGIN,
      runKey: '12487~2026-09-19~CNB',
      orderIds: ['aaaaaaaaaaaaaaaaaaaaaaa1'],
    })

    const url = new URL(renderKotScreenshots.mock.calls[0][0])
    expect(url.searchParams.get('orders')).toBe('aaaaaaaaaaaaaaaaaaaaaaa1')
    expect((await PrintJob.findOne({}))!.images).toHaveLength(1)
  })

  it('takes the station from the run key', async () => {
    await enqueueRunKotPrint({
      appOrigin: ORIGIN,
      runKey: '12487~2026-09-19~PRYJ',
      orderIds: ['aaaaaaaaaaaaaaaaaaaaaaa1'],
    })
    expect((await PrintJob.findOne({}))!.stationCode).toBe('PRYJ')
  })

  it('refuses a malformed run key rather than queueing a job with no station', async () => {
    await expect(
      enqueueRunKotPrint({ appOrigin: ORIGIN, runKey: 'nonsense', orderIds: ['a'] }),
    ).rejects.toThrow(/Malformed run key/)
    expect(await PrintJob.countDocuments({})).toBe(0)
  })

  it('throws when the render disagrees with what was asked for', async () => {
    renderKotScreenshots.mockResolvedValueOnce([Buffer.from('only-one')])
    await expect(
      enqueueRunKotPrint({ appOrigin: ORIGIN, runKey: '12487~2026-09-19~CNB', orderIds: ['a', 'b'] }),
    ).rejects.toThrow(/Rendered 1 ticket\(s\) but asked for 2/)
  })
})

describe('enqueueOrderKotPrint', () => {
  it('routes by station and keeps the outlet as provenance', async () => {
    const outlet = await makeRestaurant('YATRI BHOJAN', 'CNB')
    await enqueueOrderKotPrint({
      appOrigin: ORIGIN,
      stationCode: 'CNB',
      restaurantId: outlet._id,
      orderId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
    })

    const job = (await PrintJob.findOne({}))!
    expect(job.stationCode).toBe('CNB')
    expect(String(job.restaurantId)).toBe(String(outlet._id))
  })

  it('prints an order whose outlet matching failed', async () => {
    // Order.restaurantId is nullable but stationCode is required, so an
    // unmatched order was unprintable before and is not now.
    await enqueueOrderKotPrint({
      appOrigin: ORIGIN,
      stationCode: 'CNB',
      restaurantId: null,
      orderId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
    })
    expect((await PrintJob.findOne({}))!.stationCode).toBe('CNB')
  })

  it('normalises a lowercase station code so it cannot miss its station', async () => {
    await enqueueOrderKotPrint({
      appOrigin: ORIGIN,
      stationCode: 'cnb',
      orderId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
    })
    expect((await PrintJob.findOne({}))!.stationCode).toBe('CNB')
  })
})
