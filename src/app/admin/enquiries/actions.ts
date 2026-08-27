'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { createEnquiry } from '@/lib/repo/createEnquiry'
import { addOrderItems, findByIdOrThrow, updateOrderFields } from '@/lib/repo/orderRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { istLocalToUtc, rupeesToPaise } from '@/lib/format'
import { PACKING_CHOICES } from '@/lib/validation/order'

export type EnquiryState = { error?: string; ok?: string }

const CreateInput = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a service date'),
  stationCode: z.string().trim().min(2, 'Station code is required').max(5),
  location: z.string().trim().optional().nullable(),
  trainNo: z.string().trim().optional().nullable(),
  pax: z.coerce.number().int().min(1).optional().nullable(),
  menuSpec: z.string().trim().optional().nullable(),
  scheduledArrival: z.string().optional().nullable(),
  contactName: z.string().trim().optional().nullable(),
  contactPhone: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
  rawPaste: z.string().default(''),
})

export async function createEnquiryAction(
  _prev: EnquiryState,
  formData: FormData,
): Promise<EnquiryState> {
  const ctx = await requireRole('ADMIN')
  const parsed = CreateInput.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const d = parsed.data
  let id: string
  try {
    const doc = await createEnquiry(ctx, {
      serviceDate: d.serviceDate,
      stationCode: d.stationCode.toUpperCase(),
      location: d.location || null,
      trainNo: d.trainNo || null,
      pax: d.pax ?? null,
      menuSpec: d.menuSpec || null,
      scheduledArrival: d.scheduledArrival || null,
      contactName: d.contactName || null,
      contactPhone: d.contactPhone || null,
      notes: d.notes || null,
      rawPaste: d.rawPaste,
    })
    id = String(doc._id)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the enquiry.' }
  }

  revalidatePath('/admin/enquiries')
  redirect(`/admin/enquiries/${id}`)
}

const QuoteInput = z.object({
  orderId: z.string().min(1),
  restaurantId: z.string().min(1, 'Choose an outlet'),
  amountRupees: z.string().min(1, 'Enter a quoted amount'),
  paymentMode: z.enum(['PREPAID', 'COD', 'INVOICE']),
  readyBy: z.string().min(1, 'Ready-by time is required'),
  contactName: z.string().trim().optional().nullable(),
  contactPhone: z.string().trim().min(6, 'A contact phone is required'),
  handoverPoint: z.string().trim().optional().nullable(),
})

/**
 * Fills in everything the completeness guard requires, then moves
 * ENQUIRY → QUOTED. The guard on QUOTED → RECEIVED still re-checks the
 * document itself — this form is a convenience, not the enforcement.
 */
export async function quoteEnquiryAction(
  _prev: EnquiryState,
  formData: FormData,
): Promise<EnquiryState> {
  const ctx = await requireRole('ADMIN')
  const parsed = QuoteInput.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }
  const d = parsed.data

  await connectDb()
  const outlet = await Restaurant.findOne({ _id: d.restaurantId, active: true })
    .select('stationCode')
    .lean()
  if (!outlet) return { error: 'That outlet does not exist or is inactive.' }

  const order = await findByIdOrThrow(ctx, d.orderId)

  // Quote details are ordinary fields, written through the scoped repository;
  // status is still only ever changed by transitionOrder.
  await updateOrderFields(ctx, d.orderId, {
    restaurantId: d.restaurantId,
    stationCode: outlet.stationCode,
    amountPaise: rupeesToPaise(d.amountRupees),
    paymentMode: d.paymentMode,
    readyBy: istLocalToUtc(d.readyBy),
    contactName: d.contactName || null,
    contactPhone: d.contactPhone,
    handoverPoint: d.handoverPoint || order.handoverPoint,
  })

  try {
    if (order.status === 'ENQUIRY') {
      await transitionOrder({ ctx, orderId: d.orderId, to: 'QUOTED', meta: { via: 'enquiry-quote' } })
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not quote.' }
  }

  revalidatePath(`/admin/enquiries/${d.orderId}`)
  return { ok: 'Quoted. Confirm when the customer accepts.' }
}

/** QUOTED → RECEIVED. The completeness guard fires here if anything is missing. */
export async function confirmEnquiryAction(
  _prev: EnquiryState,
  formData: FormData,
): Promise<EnquiryState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const packing = formData.getAll('packingItems').map(String).filter(Boolean)

  if (packing.length > 0) {
    await connectDb()
    const order = await findByIdOrThrow(ctx, orderId)
    const pax = order.pax ?? 1
    const existing = new Set(order.items.filter((i) => i.isPacking).map((i) => i.name))
    const toAdd = packing
      .filter((name) => PACKING_CHOICES.includes(name as (typeof PACKING_CHOICES)[number]))
      .filter((name) => !existing.has(name))
      .map((name) => ({ name, qty: pax, pricePaise: null, spec: null, isPacking: true, notes: null }))

    if (toAdd.length > 0) await addOrderItems(ctx, orderId, toAdd)
  }

  try {
    await transitionOrder({ ctx, orderId, to: 'RECEIVED', meta: { via: 'enquiry-confirm' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not confirm.' }
  }

  revalidatePath(`/admin/enquiries/${orderId}`)
  revalidatePath('/store')
  return { ok: 'Confirmed — it is now on the outlet dashboard.' }
}

export async function markLostAction(formData: FormData) {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  await transitionOrder({ ctx, orderId, to: 'LOST', meta: { via: 'enquiry' } })
  revalidatePath('/admin/enquiries')
  redirect('/admin/enquiries')
}
