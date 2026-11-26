import Link from 'next/link'
import { ArrowLeft, Building2, ChevronRight, History, Mail, MapPin, Plug, Route, ShieldCheck, Store, SunMoon, TrainFront, Users, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { cx, v2Focus } from './ui'

/*
 * Settings, for an owner who is not a computer person: a home page with the
 * four things they change (people, menu, kitchens, business details) as big
 * plain cards, and the one-time setup screens in a quieter list below. Each
 * opens on its own page with a way back, so there is only ever one thing on
 * the screen. The URL (?tab=) is unchanged, so every older link still works.
 */

export const SETTINGS_TABS = [
  { key: 'staff', label: 'Staff', icon: Users, group: 'main', note: 'Add or remove the people who sign in: store managers, riders and the call desk.' },
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed, group: 'main', href: '/v2/menu', note: 'Your dishes and their prices.' },
  { key: 'outlets', label: 'Kitchens', icon: Store, group: 'main', note: 'Your kitchens, and how long it takes to walk from each one to the platform.' },
  { key: 'company', label: 'Business details', icon: Building2, group: 'main', note: 'Your business name and phone number, and your plan.' },
  { key: 'mail', label: 'Order emails', icon: Mail, group: 'setup', note: 'Which emails become orders, and teaching RailServe a new aggregator’s email.' },
  { key: 'stations', label: 'Stations and printers', icon: MapPin, group: 'setup', note: 'The kitchen and the printer each station uses.' },
  { key: 'routing', label: 'Storefront names', icon: Route, group: 'setup', note: 'Which kitchen cooks for each name your kitchens use on aggregator apps.' },
  { key: 'roles', label: 'Who can do what', icon: ShieldCheck, group: 'setup', note: 'What store managers and the call desk are allowed to do.' },
  { key: 'integrations', label: 'Connections', icon: Plug, group: 'setup', note: 'Email, WhatsApp, train times and printers: whether each one is working.' },
  { key: 'activity', label: 'Activity history', icon: History, group: 'setup', href: '/v2/activity', note: 'Who changed what, and when.' },
  { key: 'trains', label: 'Check a train', icon: TrainFront, group: 'setup', note: 'The live time and platform of any train.' },
  { key: 'screen', label: 'Light or dark screen', icon: SunMoon, group: 'setup', note: 'Choose the screen colours on this device.' },
] as const

export type SettingsTabKey = Exclude<(typeof SETTINGS_TABS)[number]['key'], 'menu' | 'activity'>
type Section = (typeof SETTINGS_TABS)[number]

export function isSettingsTab(v: string | undefined): v is SettingsTabKey {
  return SETTINGS_TABS.some((t) => t.key === v && !('href' in t))
}

const hrefOf = (t: Section) => ('href' in t ? t.href : `/v2/settings?tab=${t.key}`)

/** The Settings home: the four everyday choices big, setup below in a quiet list. */
export function SettingsHome({ facts }: { facts: Partial<Record<Section['key'], string>> }) {
  const main = SETTINGS_TABS.filter((t) => t.group === 'main')
  const setup = SETTINGS_TABS.filter((t) => t.group === 'setup')
  return (
    <div className="grid max-w-[980px] gap-8">
      <nav aria-label="Settings" className="grid gap-3.5 sm:grid-cols-2">
        {main.map((t) => {
          const Icon: LucideIcon = t.icon
          return (
            <Link
              key={t.key}
              href={hrefOf(t)}
              className={cx(
                'group flex items-center gap-4 rounded-v2-xl border border-v2-line bg-v2-surface p-5 transition-all hover:-translate-y-px hover:border-v2-brand/40 hover:shadow-[0_10px_28px_-18px_rgba(16,24,20,0.35)]',
                v2Focus,
              )}
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-v2-brand-soft text-v2-brand">
                <Icon size={24} strokeWidth={2} aria-hidden />
              </span>
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="text-[18px] font-bold">{t.label}</span>
                <span className="text-[14px] leading-snug text-v2-muted">{t.note}</span>
                {facts[t.key] ? <span className="mt-0.5 text-[13px] font-semibold text-v2-brand">{facts[t.key]}</span> : null}
              </span>
              <ChevronRight size={20} aria-hidden className="shrink-0 text-v2-faint transition-transform group-hover:translate-x-0.5 group-hover:text-v2-brand" />
            </Link>
          )
        })}
      </nav>

      <section aria-labelledby="setup-title" className="grid gap-3">
        <div>
          <h2 id="setup-title" className="text-[15px] font-bold">
            Setup
          </h2>
          <p className="text-[13.5px] text-v2-muted">Set once, when you start. Ask whoever set up RailServe for you before changing these.</p>
        </div>
        <ul className="divide-y divide-v2-line overflow-hidden rounded-v2-xl border border-v2-line bg-v2-surface">
          {setup.map((t) => {
            const Icon: LucideIcon = t.icon
            return (
              <li key={t.key}>
                <Link href={hrefOf(t)} className={cx('group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-v2-surface-2', v2Focus)}>
                  <Icon size={18} strokeWidth={2} aria-hidden className="shrink-0 text-v2-muted group-hover:text-v2-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold">{t.label}</span>
                    <span className="block text-[13px] leading-snug text-v2-muted sm:truncate">{t.note}</span>
                  </span>
                  {facts[t.key] ? <span className="hidden text-[12.5px] font-semibold text-v2-muted sm:block">{facts[t.key]}</span> : null}
                  <ChevronRight size={18} aria-hidden className="shrink-0 text-v2-faint group-hover:text-v2-brand" />
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/** The top of one section: back to Settings, the section's name, and one line on what it is for. */
export function SettingsSectionHeader({ tab }: { tab: SettingsTabKey }) {
  const t = SETTINGS_TABS.find((s) => s.key === tab)!
  const Icon: LucideIcon = t.icon
  return (
    <div className="grid gap-3">
      <Link href="/v2/settings" className={cx('inline-flex w-fit items-center gap-1.5 rounded-full text-[13.5px] font-semibold text-v2-muted hover:text-v2-brand', v2Focus)}>
        <ArrowLeft size={16} aria-hidden />
        Settings
      </Link>
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-v2-brand-soft text-v2-brand">
          <Icon size={22} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">{t.label}</h1>
          <p className="text-[14px] text-v2-muted">{t.note}</p>
        </div>
      </div>
    </div>
  )
}
