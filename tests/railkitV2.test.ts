import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  V1_12561_RUN_13OCT,
  V1_22466_1739,
  V2_12561_RUN_13OCT,
  V2_16093_1746,
  V2_22466_1739,
} from './fixtures/railkitV2'

/**
 * RailKit v2 (WIMT), and v2-first-with-v1-fallback, against real payloads.
 *
 * Both SDK calls are mocked, keyed by train number, so each test states which
 * captured response each upstream sends. See railkitProvider.test.ts for why
 * the SDK is never called live from a test.
 */
const trackTrain = vi.fn()
const trackTrainV2 = vi.fn()
vi.mock('railkit', () => ({
  configure: vi.fn(),
  trackTrain: (...args: unknown[]) => trackTrain(...args),
  trackTrainV2: (...args: unknown[]) => trackTrainV2(...args),
}))

const { RailKitTrainStatusProvider } = await import('../src/lib/train/railkit')
const { RailKitV2TrainStatusProvider } = await import('../src/lib/train/railkitV2')
const { FallbackTrainStatusProvider } = await import('../src/lib/train/fallback')
const { TrainStatusUnavailable } = await import('../src/lib/train/provider')

const ist = (s: string) => new Date(`${s}+05:30`)

const V2: Record<string, unknown> = {
  '12561': V2_12561_RUN_13OCT,
  '22466': V2_22466_1739,
  '16093': V2_16093_1746,
}
const V1: Record<string, unknown> = {
  '12561': V1_12561_RUN_13OCT,
  '22466': V1_22466_1739,
}

const byTrain = (bodies: Record<string, unknown>) => async (trainNo: string) =>
  bodies[trainNo] ? structuredClone(bodies[trainNo]) : { success: false, error: 'Train not found' }

const v2 = () => new RailKitV2TrainStatusProvider('key')
const both = () =>
  new FallbackTrainStatusProvider(
    new RailKitV2TrainStatusProvider('key'),
    new RailKitTrainStatusProvider('key'),
  )

beforeEach(() => {
  trackTrain.mockReset()
  trackTrainV2.mockReset()
  trackTrain.mockImplementation(byTrain(V1))
  trackTrainV2.mockImplementation(byTrain(V2))
})

describe('RailKitV2TrainStatusProvider', () => {
  it('reads the projected arrival, delay and feed update time at our station', async () => {
    const r = await v2().getStatus('22466', '2026-10-14', 'CNB')

    expect(r.etaAt).toEqual(ist('2026-10-14T17:48:00'))
    expect(r.delayMinutes).toBe(13)
    expect(r.providerUpdatedAt).toEqual(ist('2026-10-14T17:39:00'))
    expect(r.arrived).toBe(false)
    expect(r.source).toBe('railkit-v2')
  })

  it('reports no platform rather than inventing one', async () => {
    const r = await v2().getStatus('22466', '2026-10-14', 'CNB')
    expect(r.platform).toBeNull()
  })

  it('keeps an early arrival in the ETA, where the delay is floored at zero', async () => {
    // 16093 is due 18:25; v2 projected 17:52 and called it 0 late.
    const r = await v2().getStatus('16093', '2026-10-14', 'CNB')
    expect(r.etaAt).toEqual(ist('2026-10-14T17:52:00'))
    expect(r.delayMinutes).toBe(0)
  })

  it('asks for the departure date, reading it from the numeric startDate', async () => {
    // The run reaching Kanpur on the 14th left Jaynagar on the 13th. If
    // "13-10-2026" were unreadable, the probe for the 14th would be accepted
    // and today's not-yet-started train would be reported instead.
    await v2().getStatus('12561', '2026-10-14', 'CNB')
    expect(trackTrainV2.mock.calls.at(-1)?.[1]).toBe('13-10-2026')
  })

  it('gives a halt with no actual time no ETA, not the timetable', async () => {
    // CNB on this run: departed, platform 2, but arrival.actual is null.
    const r = await v2().getStatus('12561', '2026-10-14', 'CNB')
    expect(r.etaAt).toBeNull()
    expect(r.delayMinutes).toBeNull()
    expect(r.platform).toBe('2')
  })

  it('does not mistake CNBI (Chandari) for CNB (Kanpur Central)', async () => {
    await expect(v2().getStatus('22466', '2026-10-14', 'CNBI')).rejects.toBeInstanceOf(
      TrainStatusUnavailable,
    )
  })

  it('rejects a response whose startDate it cannot read', async () => {
    const body = structuredClone(V2_22466_1739) as { data: { startDate: string } }
    body.data.startDate = '2026/10/14'
    trackTrainV2.mockResolvedValue(body)

    await expect(v2().getStatus('22466', '2026-10-14', 'CNB')).rejects.toThrow(/startDate/)
  })

  it('reports an upstream error as unavailable', async () => {
    trackTrainV2.mockResolvedValue({ success: false, error: 'LIVE_STATUS_FAILED' })
    await expect(v2().getStatus('22466', '2026-10-14', 'CNB')).rejects.toThrow('LIVE_STATUS_FAILED')
  })

  it('reports no update time when lastUpdatedAt is unreadable', async () => {
    const body = structuredClone(V2_22466_1739) as { data: { lastUpdatedAt: string } }
    body.data.lastUpdatedAt = 'just now'
    trackTrainV2.mockResolvedValue(body)

    const r = await v2().getStatus('22466', '2026-10-14', 'CNB')
    expect(r.providerUpdatedAt).toBeNull()
  })

  it('describes the train for the admin lookup', async () => {
    const d = await v2().getDetail('22466', '2026-10-14', 'CNB')

    expect(d.trainName).toBe('BABA V DHAM EXP')
    expect(d.stationName).toBe('Kanpur Central')
    expect(d.scheduledArrival).toEqual(ist('2026-10-14T17:35:00'))
    expect(d.currentStationCode).toBe('PNKD')
    expect(d.currentStationName).toBe('Panki Dham')
    expect(d.statusNote).toBe('At Panki Dham (PNKD)')
    expect(d.stopsAway).toBe(1)
    expect(d.distanceKm).toBeGreaterThan(400)
  })
})

describe('FallbackTrainStatusProvider (v2 first, v1 behind it)', () => {
  it('takes v1 when v2 has no time for our stop', async () => {
    const r = await both().getStatus('12561', '2026-10-14', 'CNB')

    expect(r.etaAt).toEqual(ist('2026-10-14T10:00:00'))
    expect(r.delayMinutes).toBe(25)
    expect(r.platform).toBe('2')
    expect(r.source).toBe('railkit')
  })

  it('keeps v2 times and borrows only the platform from v1', async () => {
    const r = await both().getStatus('22466', '2026-10-14', 'CNB')

    expect(r.etaAt).toEqual(ist('2026-10-14T17:48:00'))
    expect(r.delayMinutes).toBe(13)
    expect(r.platform).toBe('6')
    expect(r.source).toBe('railkit-v2')
  })

  it('keeps v2 times when the platform lookup fails', async () => {
    trackTrain.mockRejectedValue(new Error('socket hang up'))
    const r = await both().getStatus('22466', '2026-10-14', 'CNB')

    expect(r.etaAt).toEqual(ist('2026-10-14T17:48:00'))
    expect(r.platform).toBeNull()
  })

  it('does not call v1 when v2 has everything', async () => {
    await both().getStatus('16093', '2026-10-14', 'CNB')
    expect(trackTrain).not.toHaveBeenCalled()
  })

  it('takes v1 when v2 fails outright', async () => {
    trackTrainV2.mockResolvedValue({ success: false, error: 'LIVE_STATUS_FAILED' })
    const r = await both().getStatus('22466', '2026-10-14', 'CNB')

    expect(r.etaAt).toEqual(ist('2026-10-14T17:46:00'))
    expect(r.source).toBe('railkit')
  })

  it('names both failures when neither answers', async () => {
    trackTrainV2.mockResolvedValue({ success: false, error: 'LIVE_STATUS_FAILED' })
    trackTrain.mockResolvedValue({ success: false, error: 'Train data not available' })

    const err = await both().getStatus('22466', '2026-10-14', 'CNB').catch((e) => e)
    expect(err).toBeInstanceOf(TrainStatusUnavailable)
    expect(err.message).toMatch(/railkit-v2: .*LIVE_STATUS_FAILED/)
    expect(err.message).toMatch(/railkit: .*Train data not available/)
  })

  it('returns an empty reading, still polling, when neither has a time', async () => {
    // v2 says CNB is departed with no time; v1 sends "--" too. Believing v2's
    // `departed` here would stop polling a train whose arrival we never saw.
    const body = structuredClone(V1_12561_RUN_13OCT) as {
      data: { timeline: { stationCode: string; arrival: { actual: string; delay: string } }[] }
    }
    const cnb = body.data.timeline.find((s) => s.stationCode === 'CNB')!
    cnb.arrival.actual = '--'
    cnb.arrival.delay = ''
    trackTrain.mockResolvedValue(body)

    const r = await both().getStatus('12561', '2026-10-14', 'CNB')
    expect(r.etaAt).toBeNull()
    expect(r.delayMinutes).toBeNull()
    expect(r.platform).toBe('2')
    expect(r.arrived).toBe(false)
  })

  it('falls back for the admin lookup too', async () => {
    const d = await both().getDetail('12561', '2026-10-14', 'CNB')

    expect(d.etaAt).toEqual(ist('2026-10-14T10:00:00'))
    expect(d.stationName).toBe('KANPUR CENTRAL')
    expect(d.source).toBe('railkit')
  })
})
