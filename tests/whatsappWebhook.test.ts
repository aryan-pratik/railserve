import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { WaMessage } from '../src/lib/models'
import { findConversation, listMessages, recordInbound } from '../src/lib/repo/whatsappRepo'
import { ctxFor, makeUser, resetDb } from './fixtures'
import type { AuthContext } from '../src/lib/authContext'

/**
 * The webhook route end to end: token gate, inbound into the thread, a
 * status report onto a sent line, and a replay doing nothing twice.
 *
 * The token comes from vitest.config.mts: the env is parsed once, on the
 * first import of anything that touches it, which the fixtures already do.
 */

function post(body: unknown, opts: { token?: string | null; header?: boolean } = {}) {
  const token = opts.token === undefined ? 'test-webhook-token' : opts.token
  const url = new URL('http://localhost/api/whatsapp/webhook')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== null) {
    if (opts.header) headers['x-webhook-token'] = token
    else url.searchParams.set('token', token)
  }
  return new Request(url, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

describe('POST /api/whatsapp/webhook', () => {
  let POST: (req: Request) => Promise<Response>
  let admin: AuthContext

  beforeAll(async () => {
    await resetDb()
    admin = ctxFor(await makeUser('ADMIN', '9300000001'))
    ;({ POST } = await import('../src/app/api/whatsapp/webhook/route'))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('refuses a missing or wrong token', async () => {
    expect((await POST(post({ customerNumber: '919811111111', text: 'hi' }, { token: null }))).status).toBe(401)
    expect((await POST(post({ customerNumber: '919811111111', text: 'hi' }, { token: 'nope' }))).status).toBe(401)
  })

  it('accepts the token in the header as well as the query', async () => {
    const res = await POST(post({ customerNumber: '919811111112', contentType: 'text', text: 'via header', uuid: 'wamid.h1', direction: '0' }, { header: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, inbound: 1 })
  })

  it('puts an inbound message into the thread and a replay does not duplicate it', async () => {
    const body = {
      customerNumber: '919811111113', customerName: 'Webhook Passenger', contentType: 'text', text: 'Is my order on the way?',
      uuid: 'wamid.w1_hello', integratedNumber: '917316914325', direction: '0',
      messages: '[{"from":"919811111113","id":"wamid.w1","timestamp":"1756115753","text":{"body":"Is my order on the way?"},"type":"text"}]',
      ts: '2026-11-01T15:25:55+05:30',
    }
    const first = await (await POST(post(body))).json()
    expect(first).toMatchObject({ ok: true, inbound: 1, duplicates: 0 })
    const again = await (await POST(post(body))).json()
    expect(again).toMatchObject({ ok: true, inbound: 0, duplicates: 1 })

    const m = await WaMessage.findOne({ providerMessageId: 'wamid.w1' }).lean()
    expect(m).toMatchObject({ direction: 'IN', text: 'Is my order on the way?' })
    const c = await findConversation(admin, String(m!.conversationId))
    expect(c).toMatchObject({ phone: '919811111113', customerName: 'Webhook Passenger', unreadCount: 1 })
  })

  it('applies a status report to the message it names', async () => {
    const r = await recordInbound({
      type: 'inbound', phone: '919811111114', customerName: null, providerMessageId: 'wamid.in.s1', kind: 'TEXT',
      text: 'hi', mediaUrl: null, mediaCaption: null, at: new Date(),
    })
    await WaMessage.create({
      conversationId: r.conversationId, direction: 'OUT', kind: 'TEXT', text: 'On its way', status: 'SENT',
      providerMessageId: 'wamid.out.s1', providerRequestId: 'req-s1', createdAt: new Date(),
    })
    const res = await POST(post({ customerNumber: '919811111114', eventName: 'read', uuid: 'wamid.out.s1', requestId: 'req-s1', direction: '1' }))
    expect(await res.json()).toMatchObject({ ok: true, status: 1 })
    const msgs = await listMessages(admin, r.conversationId)
    expect(msgs.at(-1)).toMatchObject({ status: 'READ' })
  })

  it('answers 200 to what it does not understand, so MSG91 does not pause the webhook', async () => {
    const res = await POST(post({ hello: 'world' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, ignored: 1 })
    const bad = await POST(post('not json{'))
    expect(bad.status).toBe(200)
  })
})
