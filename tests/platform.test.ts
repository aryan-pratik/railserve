import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { Tenant, User } from '../src/lib/models'
import { createTenant, listTenants, setTenantStatus, PlatformInputError } from '../src/lib/repo/platformRepo'
import { loadUser } from '../src/lib/tenancy/userContext'
import { TenantGuardError } from '../src/lib/tenancy/plugin'
import { makeUser, resetDb } from './fixtures'

describe('platform: tenants', () => {
  beforeAll(async () => {
    await resetDb()
    await makeUser('ADMIN', '9000000001')
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('creates a company with its first admin, who can sign in', async () => {
    const { tenantId } = await createTenant({
      name: 'Acme Rail Foods', slug: 'acme', adminName: 'Asha', adminPhone: '9100000001', adminPassword: 'secret-123', maxOutlets: 5, maxUsers: 20,
    })
    const admin = await User.findOne({ phone: '9100000001' }).setOptions({ allTenants: true }).lean()
    expect(String(admin!.tenantId)).toBe(tenantId)
    expect(admin!.role).toBe('ADMIN')
    const loaded = await loadUser(String(admin!._id))
    expect(loaded?.tenantId).toBe(tenantId)
    expect(loaded?.platformAdmin).toBe(false)
  })

  it('refuses a handle or a phone that is already taken', async () => {
    await expect(createTenant({ name: 'X', slug: 'acme', adminName: 'A', adminPhone: '9100000009', adminPassword: 'secret-123', maxOutlets: 1, maxUsers: 1 })).rejects.toBeInstanceOf(PlatformInputError)
    await expect(createTenant({ name: 'Y', slug: 'other-co', adminName: 'A', adminPhone: '9000000001', adminPassword: 'secret-123', maxOutlets: 1, maxUsers: 1 })).rejects.toBeInstanceOf(PlatformInputError)
  })

  it('refuses to add a company while the tenant guard only logs', async () => {
    const before = process.env.TENANT_GUARD
    process.env.TENANT_GUARD = 'log'
    try {
      await expect(createTenant({ name: 'Z', slug: 'zed-co', adminName: 'A', adminPhone: '9100000077', adminPassword: 'secret-123', maxOutlets: 1, maxUsers: 1 })).rejects.toThrow(/TENANT_GUARD=throw/)
    } finally {
      if (before === undefined) delete process.env.TENANT_GUARD
      else process.env.TENANT_GUARD = before
    }
  })

  it('lists every company with its usage', async () => {
    const rows = await listTenants()
    expect(rows.map((r) => r.slug)).toContain('acme')
    expect(rows.find((r) => r.slug === 'acme')!.users).toBe(1)
    expect(rows[0].primary).toBe(true)
  })

  it('signs a suspended company out and lets it back in when reactivated', async () => {
    const acme = await Tenant.findOne({ slug: 'acme' }).lean()
    const admin = await User.findOne({ tenantId: acme!._id }).lean()
    await setTenantStatus(String(acme!._id), 'SUSPENDED', 'unpaid')
    expect(await loadUser(String(admin!._id))).toBeNull()
    await setTenantStatus(String(acme!._id), 'ACTIVE', null)
    expect(await loadUser(String(admin!._id))).not.toBeNull()
  })

  it('will not suspend the primary company', async () => {
    const primary = await Tenant.findOne({ primary: true }).lean()
    await expect(setTenantStatus(String(primary!._id), 'SUSPENDED', null)).rejects.toBeInstanceOf(PlatformInputError)
  })

  it('refuses an unscoped query on a tenant-owned model', async () => {
    await expect(User.find({ role: 'ADMIN' }).lean()).rejects.toBeInstanceOf(TenantGuardError)
    await expect(User.findById(new mongoose.Types.ObjectId())).rejects.toBeInstanceOf(TenantGuardError)
  })
})
