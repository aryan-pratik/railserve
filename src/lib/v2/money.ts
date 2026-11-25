import type { AuthContext } from '@/lib/authContext'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { cashWithStaff, pendingCashOrders, recentHandIns, ridersHoldingCash, type StaffCash } from '@/lib/repo/riderCashRepo'
import type { DueOrder } from './riders'

/*
 * The owner's cash page: where the cash from cash-on-delivery orders is.
 * Rider (owes it) → store manager or team leader (took it) → owner.
 */

export type RiderOwing = {
  id: string
  name: string
  phone: string
  isTeamLead: boolean
  owedPaise: number
  shortPaise: number
  oldestAt: string | null
  dueOrders: DueOrder[]
}

export type MoneyPage = {
  riders: RiderOwing[]
  withRidersPaise: number
  withRidersOrders: number
  shortPaise: number
  staff: StaffCash[]
  withStaffPaise: number
  handIns: Awaited<ReturnType<typeof recentHandIns>>
}

export async function loadMoney(ctx: AuthContext): Promise<MoneyPage> {
  await connectDb()
  const holderIds = await ridersHoldingCash(ctx)
  const [due, people, staff, handIns] = await Promise.all([
    pendingCashOrders(ctx, holderIds),
    holderIds.length ? User.find({ _id: { $in: holderIds }, tenantId: ctx.tenantId }).select('name phone isTeamLead').lean() : Promise.resolve([]),
    cashWithStaff(ctx),
    recentHandIns(ctx, 10),
  ])
  const riders: RiderOwing[] = people
    .map((p) => {
      const id = String(p._id)
      const mine = due.filter((o) => o.riderId === id).map(({ riderId, ...o }) => (void riderId, o))
      return {
        id,
        name: p.name,
        phone: p.phone,
        isTeamLead: p.isTeamLead === true,
        owedPaise: mine.reduce((a, o) => a + o.paise, 0),
        shortPaise: mine.reduce((a, o) => a + o.shortPaise, 0),
        oldestAt: mine[0]?.deliveredAt ?? null,
        dueOrders: mine,
      }
    })
    .filter((r) => r.owedPaise > 0)
    .sort((a, b) => b.owedPaise - a.owedPaise || a.name.localeCompare(b.name))
  const holding = staff.filter((s) => s.holdingPaise > 0)
  return {
    riders,
    withRidersPaise: riders.reduce((a, r) => a + r.owedPaise, 0),
    withRidersOrders: riders.reduce((a, r) => a + r.dueOrders.length, 0),
    shortPaise: riders.reduce((a, r) => a + r.shortPaise, 0),
    staff: holding,
    withStaffPaise: holding.reduce((a, s) => a + s.holdingPaise, 0),
    handIns,
  }
}
