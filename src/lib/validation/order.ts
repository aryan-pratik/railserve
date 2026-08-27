import { z } from 'zod'
import { ORDER_TYPES, PAYMENT_MODES } from '../orderEnums'

/**
 * Shape of the admin manual-entry form.
 *
 * Bulk and retail share one schema and diverge in refinement rather than in two
 * separate schemas, because they are the same order with different required
 * fields — and they merge into one pipeline immediately after creation.
 */
export const ManualOrderInput = z
  .object({
    orderType: z.enum(ORDER_TYPES),
    restaurantId: z.string().min(1, 'Choose an outlet'),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a service date'),

    trainNo: z.string().trim().max(10).optional().nullable(),
    trainName: z.string().trim().max(120).optional().nullable(),
    scheduledArrival: z.string().optional().nullable(),

    coach: z.string().trim().max(10).optional().nullable(),
    berth: z.string().trim().max(10).optional().nullable(),
    handoverPoint: z.string().trim().max(300).optional().nullable(),

    contactName: z.string().trim().max(120).optional().nullable(),
    contactPhone: z.string().trim().max(20).optional().nullable(),

    pax: z.number().int().min(1).optional().nullable(),
    amountRupees: z.string().optional().nullable(),
    paymentMode: z.enum(PAYMENT_MODES).optional().nullable(),
    readyBy: z.string().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),

    // Retail: one row per dish. Bulk: a single composite menu (see menuSpec).
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Item name is required'),
          qty: z.number().int().min(1),
          priceRupees: z.string().optional().nullable(),
          isPacking: z.boolean().default(false),
          notes: z.string().trim().max(300).optional().nullable(),
        }),
      )
      .default([]),

    // Bulk only: the full thali text, kept as one block.
    menuSpec: z.string().trim().optional().nullable(),
    packingItems: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.orderType === 'BULK') {
      if (!v.pax) {
        ctx.addIssue({ code: 'custom', path: ['pax'], message: 'Pax count is required for bulk' })
      }
      if (!v.menuSpec) {
        ctx.addIssue({ code: 'custom', path: ['menuSpec'], message: 'Menu is required for bulk' })
      }
      if (!v.readyBy) {
        ctx.addIssue({ code: 'custom', path: ['readyBy'], message: 'Ready-by time is required for bulk' })
      }
      if (!v.handoverPoint) {
        ctx.addIssue({
          code: 'custom', path: ['handoverPoint'],
          message: 'Handover point is required for bulk',
        })
      }
    } else if (v.items.filter((i) => !i.isPacking).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Add at least one item' })
    }
  })

export type ManualOrderInput = z.infer<typeof ManualOrderInput>

/** The packing checklist from plan §7 — the part of a bulk order that gets forgotten. */
export const PACKING_CHOICES = [
  'Water bottle 500ml',
  'Tissue',
  'Spoon',
  'Pickle',
  'Salad',
] as const
