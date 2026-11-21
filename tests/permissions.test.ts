import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, ROLE_PRESETS, isAdjustable, permissionsFor } from '../src/lib/permissions'

describe('role permissions', () => {
  it('gives each role exactly its preset when the tenant changed nothing', () => {
    for (const role of ['ADMIN', 'STORE_MANAGER', 'TELECALLER', 'DELIVERY_AGENT'] as const) {
      expect([...permissionsFor(role, {})].sort()).toEqual([...ROLE_PRESETS[role]].sort())
    }
  })

  it('applies a tenant grant and revoke to that role only', () => {
    const overrides = { TELECALLER: { grant: ['orders.create'], revoke: ['chat.use'] } }
    const tc = permissionsFor('TELECALLER', overrides)
    expect(tc.has('orders.create')).toBe(true)
    expect(tc.has('chat.use')).toBe(false)
    expect(permissionsFor('STORE_MANAGER', overrides).has('chat.use')).toBe(false)
    expect([...permissionsFor('STORE_MANAGER', overrides)].sort()).toEqual([...ROLE_PRESETS.STORE_MANAGER].sort())
  })

  it('never lets an admin lose the permissions that run the settings', () => {
    const admin = permissionsFor('ADMIN', { ADMIN: { revoke: ['roles.manage', 'staff.manage', 'company.manage', 'menu.manage'] } })
    expect(admin.has('roles.manage')).toBe(true)
    expect(admin.has('staff.manage')).toBe(true)
    expect(admin.has('company.manage')).toBe(true)
    expect(admin.has('menu.manage')).toBe(false)
  })

  it('keeps riders to the rider app whatever a tenant grants', () => {
    expect([...permissionsFor('DELIVERY_AGENT', { DELIVERY_AGENT: { grant: ALL_PERMISSIONS } })]).toEqual(['delivery.operate'])
  })

  it('never hands roles.manage to anyone but admins', () => {
    expect(permissionsFor('STORE_MANAGER', { STORE_MANAGER: { grant: ['roles.manage'] } }).has('roles.manage')).toBe(false)
  })

  it('ignores names that are not permissions', () => {
    expect(permissionsFor('TELECALLER', { TELECALLER: { grant: ['everything'] } }).size).toBe(ROLE_PRESETS.TELECALLER.length)
  })

  it('only offers switches that are enforced, and only for abilities the role has', () => {
    expect(isAdjustable('TELECALLER', 'chat.use')).toBe(true)
    expect(isAdjustable('TELECALLER', 'orders.create')).toBe(false)
    expect(isAdjustable('STORE_MANAGER', 'kitchen.operate')).toBe(true)
    expect(isAdjustable('STORE_MANAGER', 'orders.requestCancel')).toBe(false)
    expect(isAdjustable('ADMIN', 'chat.use')).toBe(false)
  })
})
