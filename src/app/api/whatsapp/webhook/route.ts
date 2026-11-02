import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { connectDb } from '@/lib/db'
import { parseMsg91Webhook } from '@/lib/whatsapp/webhook'
import { applyStatus, recordInbound } from '@/lib/repo/whatsappRepo'

export const dynamic = 'force-dynamic'

/**
 * MSG91's WhatsApp webhook: a passenger's message, or a report on one of ours.
 *
 * Configured in the MSG91 dashboard (WhatsApp → Webhook (New)) for both
 * inbound and outbound events, pointing at
 *   https://<host>/api/whatsapp/webhook?token=<MSG91_WEBHOOK_TOKEN>
 * MSG91 signs nothing, so the token is the whole gate; with none configured
 * the endpoint refuses everything rather than accept anonymous posts into the
 * inbox. The same token may instead travel as an `x-webhook-token` header,
 * which the dashboard also allows.
 *
 * Answers 200 to anything it recognised and anything it did not: MSG91
 * pauses a webhook that keeps returning 4xx, and a payload shape this parser
 * has not met yet must not take the inbox down with it. Such payloads are
 * logged so the parser can learn them.
 */
export async function POST(request: Request) {
  if (!env.MSG91_WEBHOOK_TOKEN) {
    return NextResponse.json({ ok: false, reason: 'webhook token not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? request.headers.get('x-webhook-token')
  if (token !== env.MSG91_WEBHOOK_TOKEN) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'not json' })
  }

  // MSG91 posts one event per call, but accept a batch for good measure.
  const events = Array.isArray(body) ? body : [body]
  const summary = { inbound: 0, status: 0, duplicates: 0, ignored: 0 }

  try {
    await connectDb()
    for (const raw of events) {
      const ev = parseMsg91Webhook(raw)
      if (!ev) {
        summary.ignored += 1
        console.warn('[whatsapp-webhook] unrecognised payload', JSON.stringify(raw).slice(0, 500))
        continue
      }
      if (ev.type === 'inbound') {
        const out = await recordInbound(ev)
        if (out.duplicate) summary.duplicates += 1
        else summary.inbound += 1
      } else {
        const applied = await applyStatus(ev)
        if (applied) summary.status += 1
        else summary.ignored += 1
      }
    }
  } catch (err) {
    console.error('[whatsapp-webhook]', err)
    return NextResponse.json({ ok: false, error: 'failed', ...summary })
  }

  return NextResponse.json({ ok: true, ...summary })
}
