'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { setRtoCollectRoles } from '@/lib/repo/settingsRepo'
import { ROLE_LABEL } from '@/lib/roles'

/** Setup → Access: which roles may mark a returned order as back at the counter. */

export type AccessState = { error?: string; ok?: string }

export async function setRtoCollectRolesAction(_prev: AccessState, formData: FormData): Promise<AccessState> {
  const ctx = await requireRole('ADMIN')
  const roles = formData.getAll('role').map(String)
  try {
    const next = await setRtoCollectRoles(ctx, roles)
    revalidatePath('/admin/setup')
    revalidatePath('/store/returns')
    revalidatePath('/calls/returns')
    return {
      ok:
        next.length === 0
          ? 'Saved. Only admins can now mark returns.'
          : `Saved. ${next.map((r) => `${ROLE_LABEL[r]}s`).join(' and ')} can mark returns.`,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save.' }
  }
}
