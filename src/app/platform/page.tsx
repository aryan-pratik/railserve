import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/session'
import { listTenants } from '@/lib/repo/platformRepo'
import { formatIST } from '@/lib/format'
import { Button, Card, Chip, Mono } from '@/components/v2/ui'
import { PageHeader, Table, TableFrame, Td, Th } from '@/components/v2/Table'
import { PlatformCreateTenant } from '@/components/v2/PlatformCreateTenant'
import { setTenantStatusAction } from './actions'

export const metadata = { title: 'Platform · RailServe' }
export const dynamic = 'force-dynamic'

/**
 * The super-admin console: every customer company on the platform, how much
 * each is using, onboarding a new one, and suspending one that stops paying.
 * Reachable only by PLATFORM_ADMIN_PHONES; everyone else gets a 404.
 */
export default async function PlatformPage() {
  await requirePlatformAdmin()
  const tenants = await listTenants()
  const active = tenants.filter((t) => t.status === 'ACTIVE').length
  const orders = tenants.reduce((a, t) => a + t.orders30d, 0)

  return (
    <div className="min-h-dvh bg-v2-bg p-4 font-v2 text-v2-ink lg:p-8">
      <div className="mx-auto grid max-w-[1200px] gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader title="Platform" note="Every company using RailServe." />
          <Link href="/v2" className="text-sm font-semibold text-v2-brand hover:underline">
            Back to my company
          </Link>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-3">
          <Stat label="Companies" value={tenants.length} />
          <Stat label="Active" value={active} />
          <Stat label="Orders, last 30 days" value={orders} />
        </div>

        <Card title="Companies">
          <TableFrame>
            <Table className="min-w-[760px]">
              <thead>
                <tr>
                  <Th>Company</Th>
                  <Th align="right">Outlets</Th>
                  <Th align="right">Staff</Th>
                  <Th align="right">Orders 30d</Th>
                  <Th>Last order</Th>
                  <Th>Status</Th>
                  <Th align="right" className="relative">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-t border-v2-line">
                    <Td>
                      <span className="font-semibold">{t.name}</span>
                      <span className="block text-xs text-v2-muted">
                        <Mono>{t.slug}</Mono>
                        {t.primary ? ' · ours' : ''}
                        {t.createdAt ? ` · since ${formatIST(t.createdAt).split(',')[0]}` : ''}
                      </span>
                    </Td>
                    <Td align="right">
                      <Mono>{t.outlets}</Mono>
                    </Td>
                    <Td align="right">
                      <Mono>{t.users}</Mono>
                    </Td>
                    <Td align="right">
                      <Mono>{t.orders30d}</Mono>
                    </Td>
                    <Td className="text-xs text-v2-muted">{t.lastOrderAt ? formatIST(t.lastOrderAt) : 'none yet'}</Td>
                    <Td>
                      <Chip tone={t.status === 'ACTIVE' ? 'ok' : t.status === 'SUSPENDED' ? 'bad' : 'grey'}>{t.status.toLowerCase()}</Chip>
                    </Td>
                    <Td align="right">
                      {t.primary ? null : (
                        <form action={setTenantStatusAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="status" value={t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'} />
                          <Button type="submit" size="sm" variant={t.status === 'ACTIVE' ? 'ghost' : 'secondary'}>
                            {t.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                          </Button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableFrame>
        </Card>

        <PlatformCreateTenant />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <span className="text-[12.5px] font-semibold text-v2-ink-2">{label}</span>
      <span className="block font-mono text-3xl font-bold tabular-nums">{value}</span>
    </Card>
  )
}
