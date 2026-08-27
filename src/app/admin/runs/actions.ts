'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { assignRun } from '@/lib/repo/runRepo'

export type AssignRunState = { error?: string; ok?: string }

export async function assignRunAction(
  _prev: AssignRunState,
  formData: FormData,
): Promise<AssignRunState> {
  const ctx = await requireRole('ADMIN')
  const runKey = String(formData.get('runKey') ?? '')
  const agentIds = formData.getAll('agentIds').map(String).filter(Boolean)

  try {
    const r = await assignRun(ctx, runKey, agentIds)
    revalidatePath('/admin/runs')
    revalidatePath('/agent')

    if (r.errors.length) return { error: r.errors.join('; ') }
    return {
      ok: agentIds.length
        ? `Assigned ${r.moved} order${r.moved === 1 ? '' : 's'} on this run.`
        : `Cleared agents from ${r.moved} order${r.moved === 1 ? '' : 's'}.`,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not assign the run.' }
  }
}
