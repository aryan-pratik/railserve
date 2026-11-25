import { PillTabs } from './Table'

/**
 * Money, for an admin: cash the riders are holding, and money in the bank.
 * Two pages under one sidebar item, switched here at the top of each.
 */
export function MoneyTabs({ active }: { active: 'cash' | 'payments' }) {
  return (
    <PillTabs
      tabs={[
        { href: '/v2/money', label: 'Cash', active: active === 'cash' },
        { href: '/v2/payments', label: 'Bank payments', active: active === 'payments' },
      ]}
    />
  )
}
