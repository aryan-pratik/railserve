import { describe, expect, it } from 'vitest'
import { compareCoach, groupIntoRuns, parseRunKey, runKeyFor, NO_TRAIN } from '../src/lib/runs'

const mk = (over: Record<string, unknown> = {}) => ({
  _id: Math.random().toString(36).slice(2),
  trainNo: '12506',
  trainName: 'NORTH EAST EXP',
  serviceDate: '2026-08-27',
  stationCode: 'CNB',
  coach: 'B5',
  status: 'PREPARED',
  scheduledArrival: new Date('2026-08-27T07:55:00Z'),
  ...over,
})

describe('run keys', () => {
  it('round-trips', () => {
    const id = { trainNo: '12506', serviceDate: '2026-08-27', stationCode: 'CNB' }
    expect(parseRunKey(runKeyFor(id))).toEqual(id)
  })

  it('represents a missing train number without losing the run', () => {
    const key = runKeyFor({ trainNo: null, serviceDate: '2026-08-27', stationCode: 'CNB' })
    expect(key).toContain(NO_TRAIN)
    expect(parseRunKey(key)?.trainNo).toBeNull()
  })

  it('rejects malformed keys rather than producing a bogus run', () => {
    expect(parseRunKey('nonsense')).toBeNull()
    expect(parseRunKey('12506~not-a-date~CNB')).toBeNull()
    expect(parseRunKey('12506~2026-08-27')).toBeNull()
  })
})

describe('coach ordering', () => {
  it('walks the platform in one direction rather than doubling back', () => {
    const coaches = ['S9', 'B1', 'A1', 'S10', 'B12', 'S2', 'B2']
    expect([...coaches].sort(compareCoach)).toEqual(['A1', 'B1', 'B2', 'B12', 'S2', 'S9', 'S10'])
  })

  it('sorts numerically, not lexically — S10 comes after S9', () => {
    expect(compareCoach('S9', 'S10')).toBeLessThan(0)
  })

  it('puts a coachless bulk handover at the end of the walk', () => {
    expect([...['B2', null, 'A1']].sort(compareCoach)).toEqual(['A1', 'B2', null])
  })

  it('is case and whitespace tolerant', () => {
    expect(compareCoach(' b5 ', 'B5')).toBe(0)
  })
})

describe('grouping into runs', () => {
  it('groups by train, date and station together', () => {
    const runs = groupIntoRuns([
      mk({ coach: 'B5' }),
      mk({ coach: 'A1' }),
      mk({ trainNo: '12312', scheduledArrival: new Date('2026-08-27T04:10:00Z') }),
      mk({ stationCode: 'PRYJ' }),
      mk({ serviceDate: '2026-08-28' }),
    ])
    expect(runs).toHaveLength(4)
    const main = runs.find((r) => r.trainNo === '12506' && r.stationCode === 'CNB' && r.serviceDate === '2026-08-27')!
    expect(main.orders).toHaveLength(2)
    expect(main.orders.map((o) => o.coach)).toEqual(['A1', 'B5'])
  })

  it('orders runs by soonest arrival', () => {
    const runs = groupIntoRuns([
      mk({ trainNo: '11111', scheduledArrival: new Date('2026-08-27T12:00:00Z') }),
      mk({ trainNo: '22222', scheduledArrival: new Date('2026-08-27T06:00:00Z') }),
      mk({ trainNo: '33333', scheduledArrival: null }),
    ])
    expect(runs.map((r) => r.trainNo)).toEqual(['22222', '11111', '33333'])
  })

  it('counts statuses so a run can show how much is ready', () => {
    const runs = groupIntoRuns([
      mk({ status: 'PREPARED' }),
      mk({ status: 'PREPARED', coach: 'B6' }),
      mk({ status: 'DISPATCHED', coach: 'B7' }),
    ])
    expect(runs[0].statusCounts).toEqual({ PREPARED: 2, DISPATCHED: 1 })
  })
})
