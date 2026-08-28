import { NextResponse } from 'next/server'
import { z } from 'zod'
import { contextFromBearer } from '@/lib/mobile/token'
import { findById } from '@/lib/repo/orderRepo'
import { getProofStore, isAllowedContentType, ProofStoreUnavailable } from '@/lib/storage'

export const dynamic = 'force-dynamic'

const Body = z.object({
  orderId: z.string().min(1),
  contentType: z.string().min(1),
})

/**
 * Hands a rider a short-lived URL to PUT a delivery photo straight to the
 * bucket. The image never touches this server.
 *
 * The order is looked up through the scoped repository first, so a presigned
 * URL is only ever issued for an order the caller can actually see. Skipping
 * that would turn this into an open write endpoint keyed by a guessable id.
 */
export async function POST(request: Request) {
  const ctx = await contextFromBearer(request)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'DELIVERY_AGENT') {
    return NextResponse.json({ error: 'Only a rider may attach delivery proof' }, { status: 403 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'orderId and contentType are required' }, { status: 400 })
  }
  const { orderId, contentType } = parsed.data

  if (!isAllowedContentType(contentType)) {
    return NextResponse.json({ error: 'Only JPEG, PNG or WebP images' }, { status: 400 })
  }

  // Out of scope reads as not-found, never as forbidden — a 403 would confirm
  // the order exists to someone who should not know that.
  const order = await findById(ctx, orderId)
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  try {
    const { uploadUrl, key, expiresAt } = await getProofStore().presignUpload({
      orderId,
      contentType,
    })
    return NextResponse.json({ uploadUrl, key, expiresAt: expiresAt.toISOString() })
  } catch (err) {
    if (err instanceof ProofStoreUnavailable) {
      // Not an error the rider can act on, and not a reason to block delivery.
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[proof-url] presign failed', err)
    return NextResponse.json({ error: 'Could not prepare the upload' }, { status: 500 })
  }
}
