import { describe, expect, it } from 'vitest'
import { isAllowedSender, normaliseSenderEntry, senderAddress } from '../src/lib/ingest/senders'

describe('aggregator sender allowlist', () => {
  it('accepts an address or an @domain, and refuses anything else', () => {
    expect(normaliseSenderEntry('  Orders@Zoop.in ')).toBe('orders@zoop.in')
    expect(normaliseSenderEntry('@zoop.in')).toBe('@zoop.in')
    expect(normaliseSenderEntry('Zoop <orders@zoop.in>')).toBe('orders@zoop.in')
    expect(normaliseSenderEntry('zoop.in')).toBeNull()
    expect(normaliseSenderEntry('orders@')).toBeNull()
    expect(normaliseSenderEntry('')).toBeNull()
  })

  it('reads the address out of a From header', () => {
    expect(senderAddress('"Zoop Orders" <Orders@Zoop.in>')).toBe('orders@zoop.in')
    expect(senderAddress('orders@zoop.in')).toBe('orders@zoop.in')
    expect(senderAddress('Mail Delivery Subsystem')).toBeNull()
    expect(senderAddress(null)).toBeNull()
  })

  it('lets every sender through while the list is empty', () => {
    expect(isAllowedSender('news@shop.example', [])).toBe(true)
    expect(isAllowedSender(null, [])).toBe(true)
  })

  it('matches a listed address or a listed domain, nothing else', () => {
    const list = ['orders@zoop.in', '@yatrirestro.com']
    expect(isAllowedSender('Zoop <ORDERS@zoop.in>', list)).toBe(true)
    expect(isAllowedSender('noreply@yatrirestro.com', list)).toBe(true)
    expect(isAllowedSender('promo@zoop.in', list)).toBe(false)
    // A lookalike domain is not the listed one.
    expect(isAllowedSender('orders@yatrirestro.com.evil.example', list)).toBe(false)
    expect(isAllowedSender('no-address-here', list)).toBe(false)
    expect(isAllowedSender(null, list)).toBe(false)
  })
})
