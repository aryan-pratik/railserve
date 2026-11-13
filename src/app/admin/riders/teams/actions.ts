'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { setTeam } from '@/lib/repo/teamRepo'

export type TeamState = { error?: string; ok?: string }

/** An admin moves the ticked riders under a team leader, or out of any team. */
export async function setTeamAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const ctx = await requireRole('ADMIN')
  const riderIds = formData.getAll('riderIds').map(String).filter(Boolean)
  const lead = String(formData.get('leadId') ?? '')
  try {
    const r = await setTeam({ ctx, riderIds, leadId: lead || null })
    revalidatePath('/admin/riders/teams')
    revalidatePath('/admin/setup')
    return { ok: `${r.moved} rider${r.moved === 1 ? '' : 's'} moved.` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not move those riders.' }
  }
}
