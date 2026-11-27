'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdmin } from '@/lib/session'
import { createTenant, setTenantStatus, PlatformInputError } from '@/lib/repo/platformRepo'
import { OnboardingError, declineApplication, markPaymentReceived, reviewDocument, saveBilling } from '@/lib/repo/onboardingRepo'
import { redirect } from 'next/navigation'

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

/** Accept or reject one document of a company that is joining. */
export async function reviewDocumentAction(_prev: PlatformState, fd: FormData): Promise<PlatformState> {
  const ctx = await requirePlatformAdmin()
  const accept = str(fd, 'decision') === 'accept'
  try {
    await reviewDocument({ tenantId: str(fd, 'tenantId'), kind: str(fd, 'kind'), accept, reason: str(fd, 'reason'), adminId: String(ctx.userId) })
  } catch (err) {
    if (err instanceof OnboardingError) return { error: err.message }
    throw err
  }
  revalidatePath('/platform')
  revalidatePath(`/platform/applications/${str(fd, 'tenantId')}`)
  return { ok: accept ? 'Accepted.' : 'Sent back with your reason.' }
}

/** The joining fee arrived. */
export async function markPaidAction(_prev: PlatformState, fd: FormData): Promise<PlatformState> {
  const ctx = await requirePlatformAdmin()
  try {
    await markPaymentReceived({ tenantId: str(fd, 'tenantId'), adminId: String(ctx.userId), note: str(fd, 'note') })
  } catch (err) {
    if (err instanceof OnboardingError) return { error: err.message }
    throw err
  }
  revalidatePath('/platform')
  revalidatePath(`/platform/applications/${str(fd, 'tenantId')}`)
  return { ok: 'Payment marked received.' }
}

/** The joining fee and how to pay it, shown to every applicant. */
export async function saveBillingAction(_prev: PlatformState, fd: FormData): Promise<PlatformState> {
  await requirePlatformAdmin()
  try {
    await saveBilling({ feeRupees: str(fd, 'fee'), upiId: str(fd, 'upiId'), bankDetails: String(fd.get('bankDetails') ?? '') })
  } catch (err) {
    if (err instanceof OnboardingError) return { error: err.message }
    throw err
  }
  revalidatePath('/platform')
  return { ok: 'Saved. New applicants see this on their payment step.' }
}

/** Turn an application down, with the reason they will be told. */
export async function declineApplicationAction(_prev: PlatformState, fd: FormData): Promise<PlatformState> {
  const ctx = await requirePlatformAdmin()
  try {
    await declineApplication({ tenantId: str(fd, 'tenantId'), adminId: String(ctx.userId), reason: str(fd, 'reason') })
  } catch (err) {
    if (err instanceof OnboardingError) return { error: err.message }
    throw err
  }
  revalidatePath('/platform')
  redirect('/platform')
}
