import { describe, expect, it } from 'vitest'
import { normalizeCustomStatus } from '../src/lib/orderStatus'

describe('normalizeCustomStatus', () => {
  it('shapes free text into the same SCREAMING_SNAKE_CASE form as the fixed statuses', () => {
    expect(normalizeCustomStatus('Refund pending')).toBe('REFUND_PENDING')
  })

  it('collapses punctuation and repeated separators into a single underscore', () => {
    expect(normalizeCustomStatus('vip!! - priority')).toBe('VIP_PRIORITY')
  })

  it('trims leading and trailing separators', () => {
    expect(normalizeCustomStatus('  -escalated- ')).toBe('ESCALATED')
  })

  it('reduces to an empty string when there is nothing usable', () => {
    expect(normalizeCustomStatus('   ')).toBe('')
    expect(normalizeCustomStatus('!!!')).toBe('')
  })
})
