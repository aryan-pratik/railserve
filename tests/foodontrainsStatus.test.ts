import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { Restaurant } from '../src/lib/models'
import { makeRestaurant, resetDb } from './fixtures'
import {
  foodOnTrainsKeyFor,
  foodOnTrainsStatusFor,
  pushFoodOnTrainsStatus,
  reportFoodOnTrainsStatus,
} from '../src/lib/aggregators/foodontrains'

const DEPS = { apiUrl: 'https://ft.example/api/', apiKey: 'test-key', sleep: async () => {} }

function respond(...statuses: (number | Error)[]) {
  const fetch = vi.fn()
  for (const s of statuses) {
    if (s instanceof Error) fetch.mockRejectedValueOnce(s)
    else fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'x' }), { status: s }))
  }
  return fetch
}

describe('foodOnTrainsStatusFor', () => {
  it.each([
    ['ACCEPTED', 'confirmed'],
    ['DISPATCHED', 'out_for_delivery'],
    ['DELIVERED', 'delivered'],
    ['CANCELLED', 'cancelled'],
    ['KOT_PRINTED', null],
    ['PREPARED', null],
    ['FAILED', null],
    ['RATING_ORDER', null],
  ])('maps %s to %s', (status, expected) => {
    expect(foodOnTrainsStatusFor({ externalOrderId: 'FT-123456', status })).toBe(expected)
  })

  it('sends nothing for an order that is not an FT- id', () => {
    expect(foodOnTrainsStatusFor({ externalOrderId: '1234567', status: 'ACCEPTED' })).toBeNull()
    expect(foodOnTrainsStatusFor({ externalOrderId: null, status: 'ACCEPTED' })).toBeNull()
  })
})

describe('foodOnTrainsKeyFor', () => {
  // One key per FoodOnTrains outlet: Zaika at CNB and Zaika at GAYA, same
  // name, different keys.
  it('reads the key saved on the outlet the order belongs to', async () => {
    await resetDb()
    const cnb = await makeRestaurant('ZAIKA', 'CNB')
    const gaya = await makeRestaurant('ZAIKA', 'GAYA')
    const bare = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    await Restaurant.updateOne({ _id: cnb._id }, { foodOnTrainsApiKey: 'ftk_cnb' })
    await Restaurant.updateOne({ _id: gaya._id }, { foodOnTrainsApiKey: 'ftk_gaya' })

    expect(await foodOnTrainsKeyFor(cnb._id)).toBe('ftk_cnb')
    expect(await foodOnTrainsKeyFor(String(gaya._id))).toBe('ftk_gaya')
    expect(await foodOnTrainsKeyFor(bare._id)).toBeNull()
    expect(await foodOnTrainsKeyFor(null)).toBeNull()
  })

  it('never loads the key unless asked for it by name', async () => {
    await resetDb()
    const cnb = await makeRestaurant('ZAIKA', 'CNB')
    await Restaurant.updateOne({ _id: cnb._id }, { foodOnTrainsApiKey: 'ftk_cnb' })
    const plain = await Restaurant.findById(cnb._id).lean()
    expect(plain).not.toHaveProperty('foodOnTrainsApiKey')
  })
})

describe('pushFoodOnTrainsStatus', () => {
  it('posts the status with the key to the order URL', async () => {
    const fetch = respond(200)
    const r = await pushFoodOnTrainsStatus('FT-123456', 'confirmed', { ...DEPS, fetch })
    expect(r).toEqual({ ok: true, httpStatus: 200 })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://ft.example/api/restaurant/orders/FT-123456/status')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ status: 'confirmed' })
  })

  it.each([401, 404, 409])('treats %i as final and does not retry', async (code) => {
    const fetch = respond(code)
    const r = await pushFoodOnTrainsStatus('FT-1', 'delivered', { ...DEPS, fetch })
    expect(r.ok).toBe(false)
    expect(r.httpStatus).toBe(code)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries a 5xx and a network error with backoff', async () => {
    const fetch = respond(503, new TypeError('fetch failed'), 200)
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const r = await pushFoodOnTrainsStatus('FT-1', 'cancelled', { ...DEPS, fetch, sleep })
    expect(r.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2_000, 8_000])
  })

  it('gives up after the last retry and says why', async () => {
    const fetch = respond(500, 500, 500, 502)
    const r = await pushFoodOnTrainsStatus('FT-1', 'cancelled', { ...DEPS, fetch })
    expect(r).toMatchObject({ ok: false, httpStatus: 502 })
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})

describe('reportFoodOnTrainsStatus', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends nothing for an order whose outlet has no key', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(() => reportFoodOnTrainsStatus({ externalOrderId: 'FT-1', restaurantId: null, status: 'ACCEPTED' })).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  await disconnectDb()
})
