import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { NO_RIDER, riderClause } from '../src/lib/repo/riderFilter'

describe('riderClause', () => {
  it('matches orders with no rider for NO_RIDER', () => {
    expect(riderClause(NO_RIDER)).toEqual({ 'delivery.agentIds.0': { $exists: false } })
  })

  it('matches that rider\'s record for an id: carried, or given and not yet picked up', () => {
    const id = new mongoose.Types.ObjectId()
    const clause = riderClause(String(id)) as { $or: Record<string, unknown>[] }
    expect(clause.$or).toHaveLength(2)
    expect(String(clause.$or[0]['delivery.pickedUpBy'])).toBe(String(id))
    expect(clause.$or[1]['delivery.pickedUpBy']).toBeNull()
    expect(String(clause.$or[1]['delivery.agentIds'])).toBe(String(id))
  })

  it('ignores an empty or mangled value rather than casting it', () => {
    expect(riderClause('')).toBeNull()
    expect(riderClause('not-an-id')).toBeNull()
  })
})
