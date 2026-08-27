import { Restaurant } from '../models'
import { ForbiddenError, type AuthContext } from '../authContext'
import { istLocalToUtc, rupeesToPaise } from '../format'
import type { ManualOrderInput } from '../validation/order'
import { insertOrder, nextManualOrderId } from './orderRepo'

/**
 * Creates a manual order. The MVP's only inlet.
 *
 * Enters at RECEIVED for both retail and bulk: the ENQUIRY -> QUOTED head of
 * the bulk pipeline exists in the status machine and is tested, but no UI drives
 * it until the paste-to-parse form arrives. `source` is MANUAL and `rawPayload`
 * is null, so a later Gmail or WhatsApp ingestion writes the same document shape
 * without a migration.
 */
export async function createManualOrder(ctx: AuthContext, input: ManualOrderInput) {
  if (ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only an admin may create orders')
  }

  // Plan §2: validate restaurantId exists in the service layer. Mongo will not
  // do it for us, and an order pointing at nothing is invisible to every
  // dashboard — it simply never appears, with no error anywhere.
  const restaurant = await Restaurant.findOne({ _id: input.restaurantId, active: true })
    .select('_id stationCode')
    .lean()
  if (!restaurant) {
    throw new ForbiddenError('That outlet does not exist or is no longer active')
  }

  const isBulk = input.orderType === 'BULK'

  // Plan §7: bulk creates ONE item with qty = pax and the whole menu in `spec`.
  // Do not shred a thali into eleven rows of qty 75.
  const items = isBulk
    ? [
        {
          name: `Bulk thali × ${input.pax}`,
          qty: input.pax!,
          pricePaise: null,
          spec: input.menuSpec ?? null,
          isPacking: false,
          notes: null,
        },
        ...input.packingItems.map((name) => ({
          name,
          qty: input.pax!,
          pricePaise: null,
          spec: null,
          isPacking: true,
          notes: null,
        })),
      ]
    : input.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        pricePaise: rupeesToPaise(i.priceRupees ?? null),
        spec: null,
        isPacking: i.isPacking,
        notes: i.notes || null,
      }))

  const externalOrderId = await nextManualOrderId(input.serviceDate)

  const doc = await insertOrder({
    source: 'MANUAL',
    orderType: input.orderType,
    externalOrderId,
    status: 'RECEIVED',

    restaurantId: restaurant._id,
    stationCode: restaurant.stationCode,

    trainNo: input.trainNo || null,
    trainName: input.trainName || null,
    serviceDate: input.serviceDate,
    scheduledArrival: istLocalToUtc(input.scheduledArrival ?? ''),
    // No live tracking in the MVP — every order is on its scheduled time.
    timingSource: 'SCHEDULED',

    coach: isBulk ? null : input.coach || null,
    berth: isBulk ? null : input.berth || null,
    rawSeat:
      !isBulk && input.coach ? `${input.coach}${input.berth ? `-${input.berth}` : ''}` : null,
    handoverPoint: isBulk ? input.handoverPoint || null : null,

    contactName: input.contactName || null,
    contactPhone: input.contactPhone || null,

    pax: isBulk ? input.pax! : null,
    amountPaise: rupeesToPaise(input.amountRupees ?? null),
    paymentMode: input.paymentMode || null,

    readyBy: istLocalToUtc(input.readyBy ?? ''),
    notes: input.notes || null,

    items,
    // Birth event, so the trail starts at creation rather than at first accept.
    events: [
      {
        fromStatus: null,
        toStatus: 'RECEIVED',
        userId: ctx.userId,
        meta: { action: 'CREATED', source: 'MANUAL' },
        createdAt: new Date(),
      },
    ],
    delivery: { agentIds: [] },
    rawPayload: null,
    createdById: ctx.userId,
  })

  return doc
}
