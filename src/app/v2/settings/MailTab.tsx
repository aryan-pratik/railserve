import { MailSourcesPanel } from '@/components/v2/MailSourcesPanel'
import { loadMailSettings } from '@/lib/v2/mailSettings'
import type { AuthContext } from '@/lib/authContext'

/** Settings → Order emails: who may send orders, and the layouts taught by hand. */
export async function MailTab({ ctx }: { ctx: AuthContext }) {
  const data = await loadMailSettings(ctx.tenantId)
  return <MailSourcesPanel data={data} />
}
