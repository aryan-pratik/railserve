import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RAILKIT_12561 } from './fixtures/railkit12561'

/**
 * The RailKit adapter, against the vendor's real payload.
 *
 * The SDK is mocked rather than called: these assert our reading of a captured
 * response, and a test that spends live quota to re-learn what the fixture
 * already records is a test that stops running when the plan lapses.
 */
const trackTrain = vi.fn()
vi.mock('railkit', () => ({
  configure: vi.fn(),
  trackTrain: (...args: unknown[]) => trackTrain(...args),
}))

const { RailKitTrainStatusProvider } = await import('../src/lib/train/railkit')
const { TrainStatusUnavailable } = await import('../src/lib/train/provider')

/** IST wall time as an ISO instant, so expectations read like the timetable. */
const ist = (s: string) => new Date(`${s}+05:30`)

describe('RailKitTrainStatusProvider', () => {
  beforeEach(() => {
    trackTrain.mockReset()
    trackTrain.mockResolvedValue(structuredClone(RAILKIT_12561))
  })

  it('reads the projected arrival, delay and platform for the station we deliver at', async () => {
    const p = new RailKitTrainStatusProvider('key')
    const r = await p.getStatus('12561', '2026-09-02', 'CNB')

    // CNB is 09:35 on the 2nd, and RailKit projects it recovering to On Time.
    expect(r.etaAt).toEqual(ist('2026-09-02T09:35:00'))
    expect(r.delayMinutes).toBe(0)
    expect(r.platform).toBe('2')
  })

  it('asks for the departure date, not the date the train reaches us', async () => {
    const p = new RailKitTrainStatusProvider('key')
    await p.getStatus('12561', '2026-09-02', 'CNB')

    // The run serving Kanpur on the 2nd left Jaynagar on the 1st. Asking for
    // the 2nd returns a train that has not moved yet.
    const datesAsked = trackTrain.mock.calls.map((c) => c[1])
    expect(datesAsked).toContain('01-09-2026')
  })

  it('learns the day offset once and reuses it', async () => {
    const p = new RailKitTrainStatusProvider('key')
    await p.getStatus('12561', '2026-09-02', 'CNB')
    const afterFirst = trackTrain.mock.calls.length

    await p.getStatus('12561', '2026-09-03', 'CNB')
    const secondLookup = trackTrain.mock.calls.length - afterFirst

    expect(secondLookup).toBe(1)
    expect(trackTrain.mock.calls.at(-1)?.[1]).toBe('02-09-2026')
  })

  it('does not mistake CNBI (Chandari) for CNB (Kanpur Central)', async () => {
    const p = new RailKitTrainStatusProvider('key')
    // CNBI is an intermediate with no times at all; a substring match would
    // find it first and report missing data for a station we do serve.
    const r = await p.getStatus('12561', '2026-09-02', 'CNB')
    expect(r.etaAt).not.toBeNull()
  })

  it('refuses a station the train does not stop at', async () => {
    const p = new RailKitTrainStatusProvider('key')
    await expect(p.getStatus('12561', '2026-09-02', 'NDLS')).rejects.toBeInstanceOf(
      TrainStatusUnavailable,
    )
  })

  describe('delay strings', () => {
    const withDelay = (delay: string, scheduled = '09:35 02-Sep') => {
      const body = structuredClone(RAILKIT_12561) as {
        data: { timeline: { stationCode: string; arrival?: { delay?: string; actual?: string; scheduled?: string } }[] }
      }
      const cnb = body.data.timeline.find((s) => s.stationCode === 'CNB')!
      cnb.arrival = { scheduled, actual: scheduled, delay }
      return body
    }

    it.each([
      ['On Time', 0],
      ['22 Min', 22],
      ['9 Min', 9],
      ['01:20 Hr', 80],
      ['01:05 Hr', 65],
      ['60 Min', 60],
    ])('reads %s as %i minutes', async (delay, expected) => {
      trackTrain.mockResolvedValue(withDelay(delay as string))
      const p = new RailKitTrainStatusProvider('key')
      const r = await p.getStatus('12561', '2026-09-02', 'CNB')
      expect(r.delayMinutes).toBe(expected)
    })

    it('fails closed on a delay it cannot read, rather than reporting zero', async () => {
      // Reporting 0 would silently cancel the KOT delay warning.
      trackTrain.mockResolvedValue(withDelay('sometime tomorrow'))
      const p = new RailKitTrainStatusProvider('key')
      const r = await p.getStatus('12561', '2026-09-02', 'CNB')
      expect(r.delayMinutes).toBeNull()
    })
  })

  it('carries the year across a New Year run', async () => {
    const body = structuredClone(RAILKIT_12561) as {
      data: { date: string; timeline: { stationCode: string; arrival?: unknown }[] }
    }
    body.data.date = '31-Dec-2026'
    const cnb = body.data.timeline.find((s) => s.stationCode === 'CNB')!
    cnb.arrival = { scheduled: '09:35 01-Jan', actual: '09:35 01-Jan*', delay: 'On Time' }
    trackTrain.mockResolvedValue(body)

    const p = new RailKitTrainStatusProvider('key')
    const r = await p.getStatus('12561', '2027-01-01', 'CNB')
    // Not 2026 — a January stop on a December departure is next year.
    expect(r.etaAt).toEqual(ist('2027-01-01T09:35:00'))
  })

  it('reports an upstream error as unavailable rather than throwing raw', async () => {
    trackTrain.mockResolvedValue({ success: false, error: 'train not found' })
    const p = new RailKitTrainStatusProvider('key')
    await expect(p.getStatus('99999', '2026-09-02', 'CNB')).rejects.toThrow(/train not found/)
  })

  it('names a spent quota precisely, so the banner can say so', async () => {
    trackTrain.mockRejectedValue(new Error('Request failed with status 429 rate limit'))
    const p = new RailKitTrainStatusProvider('key')
    await expect(p.getStatus('12561', '2026-09-02', 'CNB')).rejects.toThrow(/quota exhausted/)
  })

  it('names a rejected key precisely', async () => {
    trackTrain.mockRejectedValue(new Error('401 Invalid API key'))
    const p = new RailKitTrainStatusProvider('key')
    await expect(p.getStatus('12561', '2026-09-02', 'CNB')).rejects.toThrow(/rejected the key/)
  })
})
