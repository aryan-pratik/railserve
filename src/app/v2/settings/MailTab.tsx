import { MailSourcesPanel } from '@/components/v2/MailSourcesPanel'
import { GmailLinkCard } from '@/components/v2/GmailLinkCard'
import { gmailCardData } from '@/lib/v2/gmailCard'
import { SenderAllowlist } from '@/components/v2/SettingsRouting'
import { Card, Chip } from '@/components/v2/ui'
import { loadMailSettings } from '@/lib/v2/mailSettings'
import type { AuthContext } from '@/lib/authContext'

/** Settings → Order emails: who may send orders, and the layouts taught by hand. */
export async function MailTab({ ctx, query = {} }: { ctx: AuthContext; query?: { gmail?: string; reason?: string } }) {
  const [data, gmail] = await Promise.all([loadMailSettings(ctx.tenantId), gmailCardData(String(ctx.tenantId), 'settings', query)])
  // The older sender list still filters mail while "only listed senders" is
  // off. Empty, it lets everything through and there is nothing to show; with
  // addresses in it, it is a live filter and must stay visible and editable.
  const olderListFilters = !data.enforce && data.legacy.length > 0
  return (
    <div className="grid gap-3.5">
      <GmailLinkCard data={gmail} />
      {olderListFilters ? (
        <Card title="Older sender list" action={<Chip tone="warn">{data.legacy.length} listed</Chip>}>
          <p className="text-[13.5px] text-v2-muted">
            Only email from these addresses is read right now. Mail from anyone else is ignored. Remove every address to read all senders again.
          </p>
          <SenderAllowlist senders={data.legacy} />
        </Card>
      ) : null}
      <MailSourcesPanel data={data} />
    </div>
  )
}
