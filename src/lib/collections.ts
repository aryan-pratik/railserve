import type { Role } from './roles'

/**
 * Who may mark a rider's cash as received. Pure rules, one copy.
 *
 * Taking cash is the one step where money leaves the record of the person
 * who collected it, so who may do it is an admin's decision per person, not
 * a property of a role:
 *
 * - an admin always may
 * - a store manager may unless an admin has switched it off for them. Every
 *   manager could before the switch existed, and turning them all off on the
 *   day of an upgrade would stop the evening handover
 * - a rider team leader may only when an admin has switched it on, and then
 *   only for riders on their own team
 * - nobody else: a rider cannot receive their own cash, and a telecaller is
 *   not at the counter
 */
export type CashReceiver = {
  role: Role
  canReceiveCash?: boolean | null
  isTeamLead?: boolean | null
}

export function canReceiveCash(user: CashReceiver): boolean {
  if (user.role === 'ADMIN') return true
  if (user.role === 'STORE_MANAGER') return user.canReceiveCash !== false
  if (user.role === 'DELIVERY_AGENT') return user.isTeamLead === true && user.canReceiveCash === true
  return false
}

/** How the receiver's standing reads beside their name. */
export function receiverLabel(user: { role: Role | string; isTeamLead?: boolean | null }): string {
  if (user.role === 'ADMIN') return 'Admin'
  if (user.role === 'STORE_MANAGER') return 'Store manager'
  if (user.role === 'DELIVERY_AGENT' && user.isTeamLead) return 'Team leader'
  return 'Staff'
}
