import { cookies } from 'next/headers'
import { requireAuth, getSessionUser } from '@/lib/session'
import { ROLE_LABEL } from '@/lib/roles'
import { THEME_COOKIE, readThemeChoice } from '@/lib/v2/theme'
import { Card } from '@/components/v2/ui'
import { KeyValue, PageHeader } from '@/components/v2/Table'
import { ThemeSwitch } from '@/components/v2/ThemeSwitch'

export const metadata = { title: 'Your account · RailServe' }

/** Who is signed in, and the one personal setting: light or dark screen. */
export default async function AccountPage() {
  const ctx = await requireAuth()
  const user = await getSessionUser()
  const theme = readThemeChoice((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <div className="grid max-w-[760px] gap-5">
      <PageHeader title="Your account" />
      <Card title="You">
        <KeyValue
          rows={[
            { label: 'Name', value: user?.name ?? '' },
            { label: 'Job', value: ROLE_LABEL[ctx.role] },
            { label: 'Company', value: user?.tenantName ?? '' },
          ]}
        />
      </Card>
      <Card title="Screen colours">
        <ThemeSwitch initial={theme} />
      </Card>
    </div>
  )
}
