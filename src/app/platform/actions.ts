'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdmin } from '@/lib/session'
import { createTenant, setTenantStatus, PlatformInputError } from '@/lib/repo/platformRepo'

export type PlatformState = { ok?: string; error?: string }

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()

export async function createTenantAction(_prev: PlatformState, fd: FormData): Promise<PlatformState> {
  await requirePlatformAdmin()
  const name = str(fd, 'name')
  const adminName = str(fd, 'adminName')
  const adminPhone = str(fd, 'adminPhone').replace(/\D/g, '')
  const adminPassword = str(fd, 'adminPassword')
  if (!name || !adminName) return { error: 'Company name and admin name are required.' }
  if (!/^\d{10}$/.test(adminPhone)) return { error: 'Admin phone: 10 digits.' }
  if (adminPassword.length < 8) return { error: 'Temporary password: at least 8 characters.' }
  const maxOutlets = Math.max(1, Math.min(500, Number(str(fd, 'maxOutlets')) || 10))
  const maxUsers = Math.max(1, Math.min(5000, Number(str(fd, 'maxUsers')) || 100))
  try {
    await createTenant({ name, slug: str(fd, 'slug') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), adminName, adminPhone, adminPassword, maxOutlets, maxUsers })
  } catch (err) {
    if (err instanceof PlatformInputError) return { error: err.message }
    throw err
  }
  revalidatePath('/platform')
  return { ok: `${name} created. Their admin signs in with ${adminPhone} and the temporary password.` }
}

export async function setTenantStatusAction(fd: FormData): Promise<void> {
  await requirePlatformAdmin()
  const status = str(fd, 'status')
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') return
  await setTenantStatus(str(fd, 'id'), status, str(fd, 'reason') || null)
  revalidatePath('/platform')
}
