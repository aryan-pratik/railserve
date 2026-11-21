import Link from 'next/link'
import { Building2, MapPin, Store, Route, Users, ShieldCheck, Plug, TrainFront, type LucideIcon } from 'lucide-react'
import { Card, cx, v2Focus } from './ui'
import { SettingsRailScroll } from './SettingsRailScroll'

/*
 * The Settings tab rail: vertical on a wide screen, a scrolling pill row on a
 * phone. Server-rendered; the active tab comes from the URL.
 */

export const SETTINGS_TABS = [
  { key: 'company', label: 'Company', icon: Building2, note: 'Your company details, plan and what you are connected to.' },
  { key: 'stations', label: 'Stations', icon: MapPin, note: 'Each station you serve: its default kitchen and its printer.' },
  { key: 'outlets', label: 'Outlets', icon: Store, note: 'Your own kitchens, one per station per brand.' },
  { key: 'routing', label: 'Routing', icon: Route, note: 'Which mail is read, and which kitchen cooks for each storefront name an aggregator uses.' },
  { key: 'staff', label: 'Staff', icon: Users, note: 'Everyone who signs in: managers, riders, telecallers and admins.' },
  { key: 'roles', label: 'Roles & access', icon: ShieldCheck, note: 'What store managers and telecallers are allowed to do.' },
  { key: 'integrations', label: 'Integrations', icon: Plug, note: 'The services this installation talks to, and whether each is healthy.' },
  { key: 'trains', label: 'Trains', icon: TrainFront, note: 'Live arrival, delay and platform for any train at any station.' },
] as const

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]['key']

export function isSettingsTab(v: string | undefined): v is SettingsTabKey {
  return SETTINGS_TABS.some((t) => t.key === v)
}

export function SettingsRail({ active, counts }: { active: SettingsTabKey; counts?: Partial<Record<SettingsTabKey, number>> }) {
  return (
    <Card className="p-2 xl:p-2.5">
      <nav
        id="settings-rail"
        aria-label="Settings sections"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] [mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] xl:mx-0 xl:grid xl:gap-0.5 xl:overflow-visible xl:px-0 xl:[-webkit-mask-image:none] xl:[mask-image:none]"
      >
        {SETTINGS_TABS.map((t) => {
          const Icon: LucideIcon = t.icon
          const on = t.key === active
          const count = counts?.[t.key]
          return (
            <Link
              key={t.key}
              href={t.key === 'company' ? '/v2/settings' : `/v2/settings?tab=${t.key}`}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'flex shrink-0 items-center gap-2.5 rounded-full px-3 py-2 text-[13.5px] font-semibold transition-colors xl:rounded-v2-md',
                on ? 'bg-v2-brand-soft text-v2-brand' : 'text-v2-ink-2 hover:bg-v2-surface-2',
                v2Focus,
              )}
            >
              <Icon size={16} strokeWidth={2.1} aria-hidden className={on ? 'text-v2-brand' : 'text-v2-muted'} />
              <span className="flex-1">{t.label}</span>
              {typeof count === 'number' ? (
                <span className={cx('rounded-md px-1.5 font-mono text-[11px] tabular-nums', on ? 'bg-v2-brand/10 text-v2-brand' : 'bg-v2-surface-2 text-v2-muted')}>{count}</span>
              ) : null}
            </Link>
          )
        })}
      </nav>
      <SettingsRailScroll navId="settings-rail" />
    </Card>
  )
}
