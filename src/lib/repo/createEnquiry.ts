import { ForbiddenError, type AuthContext } from '../authContext'
import { insertOrder, nextManualOrderId } from './orderRepo'
import { istLocalToUtc } from '../format'

/**
 * Creates a bulk enquiry at ENQUIRY. Plan §7.
 *
 * Deliberately permissive: an enquiry is an unanswered question, so outlet,
 * price and payment mode are all still unknown. The completeness guard inside
 * transitionOrder is what refuses to let it reach RECEIVED without them.
 */
export async function createEnquiry(
  ctx: AuthContext,
  input: {
    serviceDate: string
    stationCode: string
    location: string | null
    trainNo: string | null
    pax: number | null
    menuSpec: string | null
    scheduledArrival: string | null
    contactName: string | null
    contactPhone: string | null
    notes: string | null
    rawPaste: string
  },
) {
  if (ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only an admin may create enquiries')
  }

  const externalOrderId = await nextManualOrderId(input.serviceDate)

  return insertOrder({
    source: 'MANUAL',
    orderType: 'BULK',
    externalOrderId: externalOrderId.replace('MAN-', 'ENQ-'),
    status: 'ENQUIRY',

    restaurantId: null,
    stationCode: input.stationCode,

    trainNo: input.trainNo,
    trainName: null,
    serviceDate: input.serviceDate,
    scheduledArrival: istLocalToUtc(input.scheduledArrival ?? ''),
    timingSource: 'SCHEDULED',

    handoverPoint: input.location,
    contactName: input.contactName,
    contactPhone: input.contactPhone,

    pax: input.pax,
    amountPaise: null,
    paymentMode: null,
    readyBy: null,
    notes: input.notes,

    items: input.pax
      ? [
          {
            name: `Bulk thali × ${input.pax}`,
            qty: input.pax,
            pricePaise: null,
            spec: input.menuSpec,
            isPacking: false,
            notes: null,
          },
        ]
      : [],

    events: [
      {
        fromStatus: null,
        toStatus: 'ENQUIRY',
        userId: ctx.userId,
        meta: { action: 'CREATED', source: 'WHATSAPP_PASTE' },
        createdAt: new Date(),
      },
    ],
    delivery: { agentIds: [] },
    // Plan §7: the pasted original is the record of what was actually
    // requested when a dispute arises.
    rawPayload: { pastedText: input.rawPaste, pastedAt: new Date() },
    createdById: ctx.userId,
  })
}
