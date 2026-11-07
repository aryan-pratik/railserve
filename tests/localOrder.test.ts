import { describe, expect, it } from 'vitest'
import { ManualOrderInput } from '../src/lib/validation/order'
import { manualOrderFromFormData } from '../src/lib/validation/orderForm'

/**
 * Local orders: a stall at the station, a counter pickup. They never board a
 * train, so the form must not ask for one, and they still need somewhere to go.
 */
describe('local order validation', () => {
  const base = {
    orderType: 'LOCAL',
    restaurantId: '000000000000000000000001',
    serviceDate: '2026-08-27',
    handoverPoint: 'Tea stall, platform 1',
    items: [{ name: 'Samosa', qty: 20, isPacking: false }],
  }

  it('accepts a local order with no train number, coach, berth, arrival, pax or menu', () => {
    const r = ManualOrderInput.safeParse(base)
    expect(r.success).toBe(true)
  })

  it('needs at least one item, like a retail order', () => {
    const r = ManualOrderInput.safeParse({ ...base, items: [] })
    expect(r.success).toBe(false)
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toContain('items')
  })

  it('needs to know where it goes', () => {
    const r = ManualOrderInput.safeParse({ ...base, handoverPoint: undefined })
    expect(r.success).toBe(false)
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toContain('handoverPoint')
  })

  it('reads off the manual-entry form', () => {
    const fd = new FormData()
    fd.set('orderType', 'LOCAL')
    fd.set('restaurantId', base.restaurantId)
    fd.set('serviceDate', base.serviceDate)
    fd.set('handoverPoint', 'Counter pickup')
    fd.append('itemName', 'Chai')
    fd.append('itemQty', '4')
    fd.append('itemPrice', '15')
    const r = manualOrderFromFormData(fd)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.orderType).toBe('LOCAL')
      expect(r.data.trainNo).toBeUndefined()
      expect(r.data.items).toHaveLength(1)
    }
  })
})
