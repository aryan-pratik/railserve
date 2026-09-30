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

// The last hop to a real printer over TCP. Stubbed here because these tests
// are about which path a job takes and what it leaves behind; the socket
// itself is exercised against a fake printer, not against Mongo.
const printImagesDirect = vi.fn<(images: Buffer[], host: string, port: number) => Promise<void>>(
  async () => {},
)
vi.mock('@/lib/printer/directPrint', () => ({ printImagesDirect }))

const { enqueueOrderKotPrint, enqueueRunKotPrint, retryDirectPrintJobs } =
  await import('../src/lib/printer/queue')
const { PrintJob, Station } = await import('../src/lib/models')
const { resetDb, makeRestaurant, makeStation } = await import('./fixtures')

const ORIGIN = 'https://bitestation.elvo.in'

beforeEach(async () => {
  await resetDb()
  renderKotScreenshots.mockClear()
  printImagesDirect.mockClear()
  printImagesDirect.mockImplementation(async () => {})
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

/**
 * Two ways a ticket reaches a printer: an agent in the kitchen polls for it,
 * or — where the router forwards the printer to a public address — this
 * server sends it straight there. One field on the station chooses, and a
 * station that has not been switched over must not notice this code exists.
 */
describe('direct printing', () => {
  const orderJob = () =>
    enqueueOrderKotPrint({
      appOrigin: ORIGIN,
      stationCode: 'CNB',
      restaurantId: null,
      orderId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
    })

  it('leaves an agent-path station alone: the job waits to be polled', async () => {
    await makeStation('CNB')
    await orderJob()

    expect(printImagesDirect).not.toHaveBeenCalled()
    const job = (await PrintJob.findOne({}))!
    expect(job.status).toBe('pending')
    expect(job.error ?? null).toBeNull()
  })

  it('does the same for a station nobody has registered at all', async () => {
    await orderJob()
    expect(printImagesDirect).not.toHaveBeenCalled()
    expect((await PrintJob.findOne({}))!.status).toBe('pending')
  })

  it('delivers at enqueue time for a direct station, and marks the job done', async () => {
    await makeStation('CNB', { directPrinterHost: '203.0.113.7', directPrinterPort: 9200 })
    await orderJob()

    expect(printImagesDirect).toHaveBeenCalledTimes(1)
    const [images, host, port] = printImagesDirect.mock.calls[0]
    expect(images).toHaveLength(1)
    expect(host).toBe('203.0.113.7')
    expect(port).toBe(9200)

    const job = (await PrintJob.findOne({}))!
    expect(job.status).toBe('done')
    expect(job.doneAt).toBeInstanceOf(Date)
    // The station's own "last printed" clock, which the setup screen reads.
    expect((await Station.findById('CNB'))!.agentLastPrintedAt).toBeInstanceOf(Date)
  })

  it('falls back to 9100 when the station names no port', async () => {
    await makeStation('CNB', { directPrinterHost: '203.0.113.7' })
    await orderJob()
    expect(printImagesDirect.mock.calls[0][2]).toBe(9100)
  })

  it('sends a whole run as one job', async () => {
    await makeStation('CNB', { directPrinterHost: '203.0.113.7' })
    await enqueueRunKotPrint({
      appOrigin: ORIGIN,
      runKey: '12487~2026-09-19~CNB',
      orderIds: ['aaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaa2'],
    })

    expect(printImagesDirect).toHaveBeenCalledTimes(1)
    expect(printImagesDirect.mock.calls[0][0]).toHaveLength(2)
    expect((await PrintJob.findOne({}))!.status).toBe('done')
  })

  it('records an unreachable printer and leaves the job to be retried', async () => {
    // A printer being off is not a reason to fail the click that queued the
    // ticket: the job is already rendered and saved, so it stays pending.
    await makeStation('CNB', { directPrinterHost: '203.0.113.7' })
    printImagesDirect.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

    await expect(orderJob()).resolves.toBeUndefined()

    const job = (await PrintJob.findOne({}))!
    expect(job.status).toBe('pending')
    expect(job.error).toMatch(/ECONNREFUSED/)
  })
})

describe('retryDirectPrintJobs', () => {
  const pendingJobAt = (stationCode: string) =>
    PrintJob.create({
      stationCode,
      restaurantId: null,
      refType: 'order',
      refId: `ref-${stationCode}`,
      images: [Buffer.from('png')],
      status: 'pending',
    })

  it('does nothing at all when no station prints directly', async () => {
    await makeStation('CNB')
    await pendingJobAt('CNB')

    expect(await retryDirectPrintJobs()).toEqual({ attempted: 0, delivered: 0 })
    expect(printImagesDirect).not.toHaveBeenCalled()
    expect((await PrintJob.findOne({}))!.status).toBe('pending')
  })

  it('retries only the direct station, never the agent station beside it', async () => {
    await makeStation('CNB', { directPrinterHost: '203.0.113.7' })
    await makeStation('PRYJ')
    await pendingJobAt('CNB')
    await pendingJobAt('PRYJ')

    expect(await retryDirectPrintJobs()).toEqual({ attempted: 1, delivered: 1 })
    expect(printImagesDirect).toHaveBeenCalledTimes(1)
    expect((await PrintJob.findOne({ stationCode: 'CNB' }))!.status).toBe('done')
    // The agent's job is still the agent's to claim.
    expect((await PrintJob.findOne({ stationCode: 'PRYJ' }))!.status).toBe('pending')
  })

  it('reports a printer that is still down, and keeps the job for next time', async () => {
    await makeStation('CNB', { directPrinterHost: '203.0.113.7' })
    await pendingJobAt('CNB')
    printImagesDirect.mockRejectedValue(new Error('still offline'))

    expect(await retryDirectPrintJobs()).toEqual({ attempted: 1, delivered: 0 })
    const job = (await PrintJob.findOne({}))!
    expect(job.status).toBe('pending')
    expect(job.error).toMatch(/still offline/)
  })

  it('does not re-send a job that already printed', async () => {
    await makeStation('CNB', { directPrinterHost: '203.0.113.7' })
    await PrintJob.create({
      stationCode: 'CNB',
      restaurantId: null,
      refType: 'order',
      refId: 'already-done',
      images: [Buffer.from('png')],
      status: 'done',
      doneAt: new Date(),
    })

    expect(await retryDirectPrintJobs()).toEqual({ attempted: 0, delivered: 0 })
    expect(printImagesDirect).not.toHaveBeenCalled()
  })
})
