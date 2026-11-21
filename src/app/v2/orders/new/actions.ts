'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole, requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, Station } from '@/lib/models'
import { createManualOrder } from '@/lib/repo/createOrder'
import { createEnquiry } from '@/lib/repo/createEnquiry'
import { createOrderFromPaste } from '@/lib/ingest/paste'
import { PARSERS } from '@/lib/ingest'
import { matchOutlet } from '@/lib/ingest/outletMatch'
import { parseBulkEnquiry } from '@/lib/ingest/parsers/bulkEnquiry'
import { manualOrderFromFormData } from '@/lib/validation/orderForm'
import { paiseToRupees, utcToIstLocal } from '@/lib/format'
import { DIETS } from '@/lib/diet'
import { naturalKey } from '@/lib/tenancy/primary'
import type { Types } from 'mongoose'

/*
 * The v2 composer's actions. Creation goes through the same repository
 * functions as the v1 composers (createManualOrder, createOrderFromPaste,
 * createEnquiry); only the landing page differs, which is why the v1 actions
 * (which redirect into /admin or /store) are not reused as-is.
 */

export type ComposerState = { error?: string; ok?: string }

export type ComposerPrefill = {
  orderType?: 'RETAIL' | 'BULK' | 'LOCAL'
  restaurantId?: string
  serviceDate?: string
  scheduledArrival?: string
  trainNo?: string
  trainName?: string
  coach?: string
  berth?: string
  handoverPoint?: string
  pax?: string
  readyBy?: string
  contactName?: string
  contactPhone?: string
  stationCode?: string
  location?: string
  menuSpec?: string
  amountRupees?: string
  paymentMode?: string
  notes?: string
  items?: { name: string; qty: string; price: string }[]
}

export type ParsePasteResult =
  | { kind: 'order'; source: string; externalOrderId: string; outletName: string; outletMatched: boolean; prefill: ComposerPrefill }
  | { kind: 'enquiry'; prefill: ComposerPrefill }
  | { kind: 'none'; detail: string }

/**
 * Reads pasted text into the form without creating anything. An aggregator
 * message goes through the same parsers as email ingestion; anything else is
 * tried as a WhatsApp bulk enquiry, whose parser pre-fills what it can.
 */
export async function parsePasteAction(text: string): Promise<ParsePasteResult> {
  const ctx = await requirePermission('orders.create')
  const body = text.trim()
  if (!body) return { kind: 'none', detail: 'Paste the message first.' }

  const parser = PARSERS.find((p) => p.matches(body))
  if (parser) {
    const result = parser.parse(body, new Date())
    if (!result.ok) return { kind: 'none', detail: result.detail }
    const o = result.order
    await connectDb()
    const outlet = await matchOutlet(ctx.tenantId, o.outletName, o.stationCode, o.source)
    return {
      kind: 'order',
      source: o.source,
      externalOrderId: o.externalOrderId,
      outletName: o.outletName,
      outletMatched: outlet.ok,
      prefill: {
        orderType: 'RETAIL',
        restaurantId: outlet.ok ? outlet.restaurantId : undefined,
        serviceDate: o.scheduledArrival ? utcToIstLocal(o.scheduledArrival).slice(0, 10) : undefined,
        scheduledArrival: o.scheduledArrival ? utcToIstLocal(o.scheduledArrival) : undefined,
        trainNo: o.trainNo ?? undefined,
        trainName: o.trainName ?? undefined,
        coach: o.coach ?? undefined,
        berth: o.berth ?? undefined,
        contactName: o.contactName ?? undefined,
        contactPhone: o.contactPhone ?? undefined,
        amountRupees: o.amountPaise != null ? paiseToRupees(o.amountPaise) : undefined,
        paymentMode: o.paymentMode ?? undefined,
        items: o.items.map((i) => ({ name: i.name, qty: String(i.qty), price: '' })),
        notes: o.items.some((i) => i.notes) ? o.items.filter((i) => i.notes).map((i) => `${i.name}: ${i.notes}`).join('\n') : undefined,
      },
    }
  }

  const e = parseBulkEnquiry(body)
  const found = e.serviceDate || e.location || e.trainNo || e.pax || e.menu || e.time
  if (!found) {
    return { kind: 'none', detail: 'This is neither a recognised aggregator message nor a bulk enquiry. Fill the form by hand.' }
  }
  return {
    kind: 'enquiry',
    prefill: {
      orderType: 'BULK',
      serviceDate: e.serviceDate ?? undefined,
      stationCode: e.location ? await stationCodeFor(ctx.tenantId, e.location) : undefined,
      location: e.location ?? undefined,
      trainNo: e.trainNo ?? undefined,
      pax: e.pax ? String(e.pax) : undefined,
      menuSpec: e.menu ?? undefined,
      scheduledArrival: e.time && e.serviceDate ? `${e.serviceDate}T${e.time}` : undefined,
      notes: e.notes.length ? e.notes.join('\n') : undefined,
    },
  }
}

/**
 * "Kanpur Central" → CNB, from the stations we operate at. The enquiry form
 * needs a station code and the message never carries one; a miss leaves the
 * field for the admin.
 */
async function stationCodeFor(tenantId: Types.ObjectId, location: string): Promise<string | undefined> {
  const loc = location.toLowerCase()
  const words = new Set(loc.split(/[^a-z0-9]+/).filter((w) => w.length >= 3))
  await connectDb()
  const [stations, outlets] = await Promise.all([
    Station.find({ tenantId, active: { $ne: false } }).select('name').lean(),
    Restaurant.find({ tenantId, active: { $ne: false } }).select('stationCode stationName').lean(),
  ])
  // Station rows rarely carry a name yet; outlets each say where they are.
  const known: { code: string; name: string }[] = [
    ...stations.map((s) => ({ code: naturalKey(String(s._id)), name: (s.name ?? '').toLowerCase() })),
    ...outlets.map((o) => ({ code: String(o.stationCode), name: String(o.stationName ?? '').toLowerCase() })),
  ].filter((k) => k.code)
  for (const k of known) {
    if (words.has(k.code.toLowerCase())) return k.code
    if (k.name && (loc.includes(k.name) || k.name.includes(loc))) return k.code
  }
  for (const k of known) {
    const first = k.name.split(/[^a-z0-9]+/)[0]
    if (first && first.length >= 4 && words.has(first)) return k.code
  }
  return undefined
}

/** The whole message becomes the order, source and id and all, as ingestion would make it. */
export async function pasteOrderV2(_prev: ComposerState, formData: FormData): Promise<ComposerState> {
  const ctx = await requirePermission('orders.create')
  const result = await createOrderFromPaste(ctx, String(formData.get('body') ?? ''))
  if (!result.ok) return { error: result.detail }
  revalidatePath('/v2/orders')
  revalidatePath('/v2/kitchen')
  redirect(`/v2/orders/${result.orderId}`)
}

export async function createOrderV2(_prev: ComposerState, formData: FormData): Promise<ComposerState> {
  const ctx = await requirePermission('orders.create')
  const parsed = manualOrderFromFormData(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  let orderId: string
  try {
    const doc = await createManualOrder(ctx, parsed.data)
    orderId = String(doc._id)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the order.' }
  }
  revalidatePath('/v2/orders')
  revalidatePath('/v2/kitchen')
  redirect(`/v2/orders/${orderId}`)
}

// Same shape as the v1 enquiry form's input; the v1 schema is not exported.
const EnquiryInput = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a service date'),
  stationCode: z.string().trim().min(2, 'Station code is required').max(5),
  location: z.string().trim().optional().nullable(),
  trainNo: z.string().trim().optional().nullable(),
  pax: z.coerce.number().int().min(1).optional().nullable(),
  menuSpec: z.string().trim().optional().nullable(),
  thaliDiet: z.enum(DIETS).optional().nullable().or(z.literal('')),
  scheduledArrival: z.string().optional().nullable(),
  contactName: z.string().trim().optional().nullable(),
  contactPhone: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
  rawPaste: z.string().default(''),
})

/** Saved at ENQUIRY; it reaches an outlet only after a quote and a confirm. */
export async function createEnquiryV2(_prev: ComposerState, formData: FormData): Promise<ComposerState> {
  const ctx = await requireRole('ADMIN')
  const raw = Object.fromEntries(formData)
  if (!raw.pax) delete raw.pax
  const parsed = EnquiryInput.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
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
      thaliDiet: d.thaliDiet || null,
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
  revalidatePath('/v2/orders')
  revalidatePath('/admin/enquiries')
  redirect(`/v2/orders/${id}`)
}
