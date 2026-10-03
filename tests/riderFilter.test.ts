import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { NO_RIDER, riderClause } from '../src/lib/repo/riderFilter'

describe('riderClause', () => {
  it('matches orders with no rider for NO_RIDER', () => {
    expect(riderClause(NO_RIDER)).toEqual({ 'delivery.agentIds.0': { $exists: false } })
  })

  it('matches orders carrying that rider for an id', () => {
    const id = new mongoose.Types.ObjectId()
    const clause = riderClause(String(id))
    expect(String((clause as Record<string, unknown>)['delivery.agentIds'])).toBe(String(id))
  })

  it('ignores an empty or mangled value rather than casting it', () => {
    expect(riderClause('')).toBeNull()
    expect(riderClause('not-an-id')).toBeNull()
  })
})
