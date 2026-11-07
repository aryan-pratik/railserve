import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { WaConversation, WaMessage } from '../src/lib/models'
import {
  applyStatus,
  assignConversation,
  countUnread,
  chatVersion,
  findConversation,
  listAssignableChatUsers,
  listConversations,
  listMessages,
  listMessagesPage,
  markRead,
  openConversationForOrder,
  openConversationForPhone,
  recordInbound,
  sendOpenerTemplate,
  sendText,
} from '../src/lib/repo/whatsappRepo'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { formatPhone, normalisePhone, phoneTail } from '../src/lib/whatsapp/phone'
import { formatRemaining, sessionWindow, SESSION_WINDOW_MS } from '../src/lib/whatsapp/session'
import { parseMsg91Webhook, type InboundEvent } from '../src/lib/whatsapp/webhook'
import { Msg91Provider, extractBody } from '../src/lib/whatsapp/msg91'
import { renderTemplateBody } from '../src/lib/whatsapp/template'
import { SimulatedWhatsAppProvider } from '../src/lib/whatsapp/simulator'
import { WhatsAppSendError, type SendResult, type TemplateSend, type WhatsAppProvider } from '../src/lib/whatsapp/provider'
import { ctxFor, makeOrder, makeRestaurant, makeStation, makeUser, resetDb } from './fixtures'

/* ── pure ─────────────────────────────────────────────────────────────────── */

describe('phone normalisation', () => {
  it('adds India to a bare 10-digit mobile however it is written', () => {
    for (const raw of ['9876543210', '98765 43210', '+91 98765-43210', '0919876543210', '09876543210', '+91-9876543210']) {
      expect(normalisePhone(raw)).toBe('919876543210')
    }
  })
  it('keeps a foreign number with its own country code', () => {
    expect(normalisePhone('+44 7700 900123')).toBe('447700900123')
  })
  it('refuses what cannot be a number', () => {
    expect(normalisePhone('')).toBeNull()
    expect(normalisePhone(null)).toBeNull()
    expect(normalisePhone('12345')).toBeNull()
    expect(normalisePhone('call me')).toBeNull()
  })
  it('formats for reading aloud and matches orders on the tail', () => {
    expect(formatPhone('919876543210')).toBe('+91 98765 43210')
    expect(formatPhone('447700900123')).toBe('+447700900123')
    expect(phoneTail('919876543210')).toBe('9876543210')
  })
})

describe('24-hour window', () => {
  const now = new Date('2026-11-01T10:00:00Z')
  it('is shut when the passenger has never written', () => {
    expect(sessionWindow(null, now)).toEqual({ open: false, reason: 'never' })
  })
  it('is open inside 24 hours and shut after', () => {
    const w = sessionWindow(new Date(now.getTime() - 60_000), now)
    expect(w.open).toBe(true)
    if (w.open) expect(w.closesAt.getTime()).toBe(now.getTime() - 60_000 + SESSION_WINDOW_MS)
    expect(sessionWindow(new Date(now.getTime() - SESSION_WINDOW_MS), now)).toEqual({ open: false, reason: 'expired' })
  })
  it('says how long is left', () => {
    expect(formatRemaining(new Date(now.getTime() + 90 * 60_000), now)).toBe('1h 30m')
    expect(formatRemaining(new Date(now.getTime() + 40 * 60_000), now)).toBe('40m')
    expect(formatRemaining(new Date(now.getTime() + 2 * 3_600_000), now)).toBe('2h')
    expect(formatRemaining(new Date(now.getTime() + 10_000), now)).toBe('under a minute')
  })
})

describe('MSG91 webhook parser', () => {
  // The new webhook's inbound sample, verbatim from msg91.com/help.
  const inboundNew = {
    crqid: '', companyId: '384905', requestedAt: '2025-08-25T15:25:55+05:30', customerNumber: '917748847990',
    requestId: '', reason: '', eventName: 'delivered',
    uuid: 'wamid.HBgMOTE3NzQ4ODQ3OTkwFQIAEhggNkM2QjRBOTcxMkFGMTNDOERBMUY4MTI4RUY0MDQ2MzkA_hello',
    integratedNumber: '917316914325', templateName: '', templateLanguage: '', replyMsgId: '',
    conversationExpTimestamp: '', pluginsource: '', customerName: 'Manas', contentType: 'text', text: 'Hi',
    latitude: '', longitude: '', caption: '', filename: '', url: '', button: '',
    contacts: '[{"profile":{"name":"Manas"},"wa_id":"917748847990"}]', reaction: '', interactive: '', orders: '',
    messages: '[{"from":"917748847XXX","id":"wamid.HBgMOTE3NzQ4ODQ3OTkwFQIAEhggNkM2QjRBOTcxMkFGMTNDOERBMUY4MTI4RUY0MDQ2MzkA","timestamp":"1756115753","text":{"body":"Hi"},"type":"text"}]',
    ts: '2025-08-25T15:25:55+05:30',
  }

  it('reads an inbound text from the new webhook shape', () => {
    const ev = parseMsg91Webhook(inboundNew)
    expect(ev).toMatchObject({
      type: 'inbound',
      phone: '917748847990',
      customerName: 'Manas',
      kind: 'TEXT',
      text: 'Hi',
      // The Meta message id, not the event uuid with its suffix.
      providerMessageId: 'wamid.HBgMOTE3NzQ4ODQ3OTkwFQIAEhggNkM2QjRBOTcxMkFGMTNDOERBMUY4MTI4RUY0MDQ2MzkA',
    })
    expect((ev as InboundEvent).at.toISOString()).toBe('2025-08-25T09:55:55.000Z')
  })

  it('reads an inbound image with its caption', () => {
    const ev = parseMsg91Webhook({ ...inboundNew, contentType: 'image', text: '', caption: 'my seat', url: 'https://cdn.example/x.jpg', messages: '' , direction: '0' })
    expect(ev).toMatchObject({ type: 'inbound', kind: 'MEDIA', mediaUrl: 'https://cdn.example/x.jpg', mediaCaption: 'my seat' })
  })

  it('reads a quick-reply button tap as the passenger saying the button label', () => {
    const tap = parseMsg91Webhook({ ...inboundNew, contentType: 'button', text: '', button: 'Confirm', messages: '[{"from":"917748847990","id":"wamid.BTN1","timestamp":"1756115753","type":"button","button":{"text":"Confirm","payload":"Confirm"}}]' })
    expect(tap).toMatchObject({ type: 'inbound', kind: 'TEXT', text: 'Confirm', button: 'Confirm', providerMessageId: 'wamid.BTN1' })
    const asJson = parseMsg91Webhook({ ...inboundNew, contentType: 'button', text: '', button: '{"text":"Feedback/Complaint","payload":"fb"}', messages: '' , direction: '0', uuid: 'wamid.BTN2' })
    expect(asJson).toMatchObject({ kind: 'TEXT', text: 'Feedback/Complaint', button: 'Feedback/Complaint' })
    const inter = parseMsg91Webhook({ ...inboundNew, contentType: 'interactive', text: '', interactive: '{"type":"button_reply","button_reply":{"id":"c1","title":"Confirm"}}', messages: '', direction: '0', uuid: 'wamid.BTN3' })
    expect(inter).toMatchObject({ kind: 'TEXT', text: 'Confirm', button: 'Confirm' })
  })

  it('reads an outbound status report from the new shape', () => {
    const ev = parseMsg91Webhook({
      companyId: '384905', requestedAt: '2025-08-25T15:14:43+05:30', customerNumber: '917974565369',
      content: '{"body_1":{"type":"text","text":"1234"}}', requestId: 'df09f35ace6b45b8b38768265774a5fb', reason: '',
      eventName: 'delivered', uuid: 'wamid.HBgMOTE3OTc0NTY1MzY5FQIAERgSNjM5OTVDRUFGNjY2NkU5REEyAA==',
      integratedNumber: '917316914325', direction: '1', templateName: 'urlshort', ts: '2025-08-25T15:14:48+05:30',
    })
    expect(ev).toMatchObject({
      type: 'status',
      status: 'DELIVERED',
      providerMessageId: 'wamid.HBgMOTE3OTc0NTY1MzY5FQIAERgSNjM5OTVDRUFGNjY2NkU5REEyAA==',
      providerRequestId: 'df09f35ace6b45b8b38768265774a5fb',
    })
  })

  it('reads a failure with its reason', () => {
    const ev = parseMsg91Webhook({ customerNumber: '917974565369', eventName: 'failed', reason: 'Re-engagement message', uuid: 'wamid.X', direction: '1' })
    expect(ev).toMatchObject({ type: 'status', status: 'FAILED', reason: 'Re-engagement message' })
  })

  it('reads the old snake_case webhook shape too', () => {
    const inbound = parseMsg91Webhook({
      customer_number: '917748847990', integrated_number: '917316914325', direction: 'inbound',
      message_type: 'text', content: 'Where is my food', message_uuid: 'wamid.OLD1', submitted_at: '2025-08-25T15:25:55+05:30',
    })
    expect(inbound).toMatchObject({ type: 'inbound', text: 'Where is my food', providerMessageId: 'wamid.OLD1' })
    const status = parseMsg91Webhook({
      customer_number: '917748847990', direction: 'outbound', status: 'Read', message_uuid: 'wamid.OUT1', request_id: 'r1',
    })
    expect(status).toMatchObject({ type: 'status', status: 'READ', providerMessageId: 'wamid.OUT1' })
  })

  it('ignores what it cannot place', () => {
    expect(parseMsg91Webhook(null)).toBeNull()
    expect(parseMsg91Webhook({ eventName: 'delivered' })).toBeNull()
    expect(parseMsg91Webhook({ customerNumber: '917748847990', eventName: 'clicked', uuid: 'x', direction: '1' })).toBeNull()
  })
})

describe('template body rendering', () => {
  it('fills positional variables and leaves what it cannot fill visible', () => {
    expect(renderTemplateBody('Hi {{1}}, your order *{{2}}* from *{{3}}* is here.', ['Ravi', 'FT-1', 'Ganga'])).toBe(
      'Hi Ravi, your order *FT-1* from *Ganga* is here.',
    )
    expect(renderTemplateBody('Hi {{1}}, order {{ 2 }}.', ['Ravi'])).toBe('Hi Ravi, order {{ 2 }}.')
  })
  it("pulls the BODY text for the right language out of MSG91's template listing", () => {
    const listing = {
      data: [
        {
          name: 'order_delivered',
          languages: [
            { language: 'hi', code: [{ type: 'BODY', text: 'नमस्ते {{1}}' }] },
            { language: 'en', code: [{ type: 'HEADER', text: 'foodontrains' }, { type: 'BODY', text: 'Hi {{1}}, delivered.' }] },
          ],
        },
      ],
    }
    expect(extractBody(listing, 'order_delivered', 'en')).toBe('Hi {{1}}, delivered.')
    expect(extractBody(listing, 'order_delivered', 'hi')).toBe('नमस्ते {{1}}')
    expect(extractBody(listing, 'other', 'en')).toBeNull()
    expect(extractBody({ status: 'fail' }, 'order_delivered', 'en')).toBeNull()
  })
})

describe('MSG91 provider', () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
    const calls: { url: string; init: RequestInit }[] = []
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      calls.push({ url: u, init: init ?? {} })
      const out = handler(u, init ?? {})
      return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    return { impl, calls }
  }

  const provider = (f: typeof fetch) =>
    new Msg91Provider({ authKey: 'KEY', integratedNumber: '917316914325', baseUrl: 'https://control.msg91.com/api/v5/whatsapp', fetchImpl: f })

  it('sends a session text with the documented fields and the authkey header', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: { status: 'success', request_id: 'req-1' } }))
    const out = await provider(impl).sendText('919876543210', 'On its way')
    expect(out).toEqual({ providerMessageId: null, providerRequestId: 'req-1' })
    const u = new URL(calls[0].url)
    expect(u.pathname).toBe('/api/v5/whatsapp/whatsapp-outbound-message/')
    expect(u.searchParams.get('recipient_number')).toBe('919876543210')
    expect(u.searchParams.get('content_type')).toBe('text')
    expect(u.searchParams.get('text')).toBe('On its way')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      integrated_number: '917316914325', recipient_number: '919876543210', content_type: 'text', text: 'On its way',
    })
    expect((calls[0].init.headers as Record<string, string>).authkey).toBe('KEY')
  })

  it('sends a template through the bulk endpoint with positional body values', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: { status: 'success', request_id: 'req-2' } }))
    await provider(impl).sendTemplate({ to: '919876543210', name: 'order_update', language: 'en', bodyValues: ['FT-123'] })
    expect(calls[0].url).toBe('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      integrated_number: '917316914325',
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: 'order_update',
          language: { code: 'en', policy: 'deterministic' },
          to_and_components: [{ to: ['919876543210'], components: { body_1: { type: 'text', value: 'FT-123' } } }],
        },
      },
    })
  })

  it('refuses a non-JSON body, a network failure and a timeout, without leaking the key', async () => {
    const { impl: html } = fakeFetch(() => ({ status: 200, body: '<html>gateway</html>' }))
    const htmlProvider = new Msg91Provider({ authKey: 'SECRETKEY', integratedNumber: '1', baseUrl: 'https://x', fetchImpl: (async () => new Response('<html>gateway</html>', { status: 200 })) as typeof fetch })
    await expect(htmlProvider.sendText('919876543210', 'x')).rejects.toThrow(/other than JSON/)
    await expect(htmlProvider.sendText('919876543210', 'x')).rejects.not.toThrow(/SECRETKEY/)
    void html

    const down = new Msg91Provider({ authKey: 'K', integratedNumber: '1', baseUrl: 'https://x', fetchImpl: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
    await expect(down.sendText('919876543210', 'x')).rejects.toThrow(/Could not reach MSG91/)

    const slow = new Msg91Provider({ authKey: 'K', integratedNumber: '1', baseUrl: 'https://x', fetchImpl: (async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) }) as typeof fetch })
    await expect(slow.sendText('919876543210', 'x')).rejects.toThrow(/did not answer in time/)

    // The nested `data.request_id` shape some MSG91 endpoints use.
    const { impl: nested } = fakeFetch(() => ({ status: 200, body: { status: 'success', data: { request_id: 'nested-1' } } }))
    expect(await provider(nested).sendTemplate({ to: '919876543210', name: 't', language: 'en', bodyValues: [] })).toEqual({ providerMessageId: null, providerRequestId: 'nested-1' })
  })

  it('sends the template namespace when one is configured', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: { status: 'success', request_id: 'r' } }))
    const p = new Msg91Provider({ authKey: 'K', integratedNumber: '1', baseUrl: 'https://x', namespace: 'ns_1', fetchImpl: impl })
    await p.sendTemplate({ to: '919876543210', name: 't', language: 'en', bodyValues: [] })
    expect(JSON.parse(String(calls[0].init.body)).payload.template.namespace).toBe('ns_1')
  })

  it('treats a 200 with status fail as a refusal, with the reason', async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: { status: 'fail', message: 'Invalid integrated number' } }))
    await expect(provider(impl).sendText('919876543210', 'x')).rejects.toThrow(/Invalid integrated number/)
    const { impl: impl4 } = fakeFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }))
    await expect(provider(impl4).sendText('919876543210', 'x')).rejects.toBeInstanceOf(WhatsAppSendError)
  })
})

/* ── integration ──────────────────────────────────────────────────────────── */

/**
 * A provider that records what it was asked and answers whatever it is told
 * to. Ids come from one counter for the whole file: the unique index on
 * providerMessageId is real here, and would otherwise trip across tests.
 */
let fakeSeq = 0
class FakeProvider implements WhatsAppProvider {
  readonly name = 'simulator' as const
  texts: { to: string; text: string }[] = []
  templates: TemplateSend[] = []
  fail: string | null = null
  private next(): SendResult {
    fakeSeq += 1
    return { providerMessageId: `wamid.fake.${fakeSeq}`, providerRequestId: `req.${fakeSeq}` }
  }
  async sendText(to: string, text: string): Promise<SendResult> {
    if (this.fail) throw new WhatsAppSendError(this.fail)
    this.texts.push({ to, text })
    return this.next()
  }
  async sendTemplate(send: TemplateSend): Promise<SendResult> {
    if (this.fail) throw new WhatsAppSendError(this.fail)
    this.templates.push(send)
    return this.next()
  }
  body: string | null = 'Hello {{1}}, about order {{2}}.'
  async templateBody(): Promise<string | null> {
    return this.body
  }
}

function inbound(phone: string, text: string, id = `wamid.in.${Math.random().toString(36).slice(2)}`, at = new Date()): InboundEvent {
  return { type: 'inbound', phone, customerName: null, providerMessageId: id, kind: 'TEXT', text, button: null, mediaUrl: null, mediaCaption: null, at }
}

describe('whatsapp chat', () => {
  let telecaller: AuthContext
  let otherTelecaller: AuthContext
  let admin: AuthContext
  let manager: AuthContext
  let rider: AuthContext
  let ganga: mongoose.Types.ObjectId
  let annapurna: mongoose.Types.ObjectId
  let seq = 0

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const a = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    ganga = g._id
    annapurna = a._id
    admin = ctxFor(await makeUser('ADMIN', '9200000001'))
    telecaller = ctxFor(await makeUser('TELECALLER', '9200000002', ganga))
    otherTelecaller = ctxFor(await makeUser('TELECALLER', '9200000003', annapurna))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9200000004', ganga))
    rider = ctxFor(await makeUser('DELIVERY_AGENT', '9200000005', ganga))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  /** A fresh passenger number each time, so threads never collide across tests. */
  function phone() {
    seq += 1
    return `98${String(seq).padStart(8, '0')}`
  }

  describe('opening a thread from an order', () => {
    it('creates one thread per number, aimed at the order and its outlet', async () => {
      const p = phone()
      const o = await makeOrder({ restaurantId: ganga, contactPhone: `+91 ${p.slice(0, 5)} ${p.slice(5)}`, contactName: 'Ramesh' })
      const id = await openConversationForOrder(telecaller, String(o._id))
      const c = await findConversation(telecaller, id)
      expect(c).toMatchObject({ phone: `91${p}`, customerName: 'Ramesh', unreadCount: 0 })
      expect(String(c!.restaurantId)).toBe(String(ganga))
      expect(String(c!.orderId)).toBe(String(o._id))

      // A second order from the same passenger lands on the same thread, re-aimed.
      const o2 = await makeOrder({ restaurantId: ganga, contactPhone: p })
      const id2 = await openConversationForOrder(telecaller, String(o2._id))
      expect(id2).toBe(id)
      expect(String((await findConversation(telecaller, id))!.orderId)).toBe(String(o2._id))
      expect(await WaConversation.countDocuments({ phone: `91${p}` })).toBe(1)
    })

    it("is a 404 for another outlet's order", async () => {
      const o = await makeOrder({ restaurantId: annapurna, stationCode: 'PRYJ', contactPhone: phone() })
      await expect(openConversationForOrder(telecaller, String(o._id))).rejects.toBeInstanceOf(NotFoundError)
    })

    it("refuses to re-aim a thread another outlet holds, and claims an unclaimed one", async () => {
      // The passenger chats with Annapurna first.
      const p = phone()
      const theirs = await makeOrder({ restaurantId: annapurna, stationCode: 'PRYJ', contactPhone: p })
      const id = await openConversationForOrder(otherTelecaller, String(theirs._id))
      await recordInbound(inbound(`91${p}`, 'hello annapurna'))
      // They also order at Ganga. Ganga's telecaller may not pull the thread over.
      const mine = await makeOrder({ restaurantId: ganga, contactPhone: p })
      await expect(openConversationForOrder(telecaller, String(mine._id))).rejects.toBeInstanceOf(ForbiddenError)
      const c = await findConversation(admin, id)
      expect(String(c!.restaurantId)).toBe(String(annapurna))
      expect(String(c!.orderId)).toBe(String(theirs._id))
      expect(await findConversation(telecaller, id)).toBeNull()
      // An admin opening the Ganga order re-aims the order pointer but leaves the outlet alone.
      expect(await openConversationForOrder(admin, String(mine._id))).toBe(id)
      const after = await findConversation(admin, id)
      expect(String(after!.restaurantId)).toBe(String(annapurna))
      expect(String(after!.orderId)).toBe(String(mine._id))

      // A stranger's unclaimed thread is claimed by the first outlet that opens an order for it.
      const q = phone()
      const stray = await recordInbound(inbound(`91${q}`, 'anyone there?'))
      const o = await makeOrder({ restaurantId: ganga, contactPhone: q })
      expect(await openConversationForOrder(telecaller, String(o._id))).toBe(stray.conversationId)
      expect(String((await findConversation(telecaller, stray.conversationId))!.restaurantId)).toBe(String(ganga))
    })

    it('puts a freshly opened thread at the top of the rail, not under week-old ones', async () => {
      const old = await recordInbound(inbound(`91${phone()}`, 'old', undefined, new Date('2026-01-01T00:00:00Z')))
      const o = await makeOrder({ restaurantId: ganga, contactPhone: phone() })
      const fresh = await openConversationForOrder(telecaller, String(o._id))
      const typed = await openConversationForPhone(telecaller, phone())
      const { rows } = await listConversations(telecaller, { limit: 200 })
      const ids = rows.map((c) => String(c._id))
      expect(ids.indexOf(fresh)).toBeLessThan(ids.indexOf(old.conversationId))
      expect(ids.indexOf(typed)).toBeLessThan(ids.indexOf(old.conversationId))
      expect(rows.find((c) => String(c._id) === fresh)!.lastMessageAt).not.toBeNull()
    })

    it('refuses an order with no usable number', async () => {
      const o = await makeOrder({ restaurantId: ganga, contactPhone: null })
      await expect(openConversationForOrder(telecaller, String(o._id))).rejects.toBeInstanceOf(ConflictError)
    })

    it('is for telecallers and admins only', async () => {
      const o = await makeOrder({ restaurantId: ganga, contactPhone: phone() })
      await expect(openConversationForOrder(manager, String(o._id))).rejects.toBeInstanceOf(ForbiddenError)
      await expect(openConversationForOrder(admin, String(o._id))).resolves.toBeTypeOf('string')
    })
  })

  describe('opening a thread from a number', () => {
    it('normalises the number and claims the telecaller\'s one outlet', async () => {
      const p = phone()
      const id = await openConversationForPhone(telecaller, `${p.slice(0, 5)} ${p.slice(5)}`, 'Sita')
      const c = await findConversation(telecaller, id)
      expect(c).toMatchObject({ phone: `91${p}`, customerName: 'Sita' })
      expect(String(c!.restaurantId)).toBe(String(ganga))
    })

    it('links the newest order from that number when one exists', async () => {
      const p = phone()
      await makeOrder({ restaurantId: ganga, contactPhone: p, contactName: 'Old', createdAt: new Date('2026-01-01') })
      const newer = await makeOrder({ restaurantId: ganga, contactPhone: `0${p}`, contactName: 'New' })
      const id = await openConversationForPhone(telecaller, p)
      const c = await findConversation(telecaller, id)
      expect(String(c!.orderId)).toBe(String(newer._id))
      expect(c!.customerName).toBe('New')
    })

    it("refuses a number already in another outlet's thread rather than duplicate it", async () => {
      const p = phone()
      await openConversationForPhone(otherTelecaller, p)
      await expect(openConversationForPhone(telecaller, p)).rejects.toBeInstanceOf(ForbiddenError)
      // The same telecaller asking again gets the same thread back.
      const again = await openConversationForPhone(otherTelecaller, p)
      expect(await WaConversation.countDocuments({ phone: `91${p}` })).toBe(1)
      expect(again).toBeTypeOf('string')
    })

    it('rejects junk', async () => {
      await expect(openConversationForPhone(telecaller, '12')).rejects.toBeInstanceOf(ConflictError)
    })
  })

  describe('scope', () => {
    it("shows a telecaller their outlets' threads and unclaimed ones, nothing else", async () => {
      const mine = await openConversationForPhone(telecaller, phone())
      const theirs = await openConversationForPhone(otherTelecaller, phone())
      // A stranger wrote in with no order anywhere: unclaimed.
      const stray = await recordInbound(inbound(`91${phone()}`, 'Hello?'))

      expect(await findConversation(telecaller, mine)).not.toBeNull()
      expect(await findConversation(telecaller, theirs)).toBeNull()
      expect(await findConversation(telecaller, stray.conversationId)).not.toBeNull()
      expect(await findConversation(otherTelecaller, stray.conversationId)).not.toBeNull()
      expect(await findConversation(admin, theirs)).not.toBeNull()

      const { rows } = await listConversations(telecaller, { limit: 100 })
      const ids = rows.map((r) => String(r._id))
      expect(ids).toContain(mine)
      expect(ids).toContain(stray.conversationId)
      expect(ids).not.toContain(theirs)

      await expect(listMessages(telecaller, theirs)).rejects.toBeInstanceOf(NotFoundError)
      await expect(listConversations(manager)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('is for telecallers and admins only: a store manager and a rider are refused everywhere', async () => {
      const id = await openConversationForPhone(telecaller, phone())
      for (const who of [manager, rider]) {
        await expect(listConversations(who)).rejects.toBeInstanceOf(ForbiddenError)
        await expect(findConversation(who, id)).rejects.toBeInstanceOf(ForbiddenError)
        await expect(listMessages(who, id)).rejects.toBeInstanceOf(ForbiddenError)
        await expect(countUnread(who)).rejects.toBeInstanceOf(ForbiddenError)
        await expect(openConversationForPhone(who, phone())).rejects.toBeInstanceOf(ForbiddenError)
        await expect(sendText(who, id, 'hi', new FakeProvider())).rejects.toBeInstanceOf(ForbiddenError)
        await expect(assignConversation(who, id, null)).rejects.toBeInstanceOf(ForbiddenError)
        await expect(listAssignableChatUsers(who)).rejects.toBeInstanceOf(ForbiddenError)
      }
    })

    it('a telecaller with no outlets sees nothing', async () => {
      const nobody: AuthContext = { ...telecaller, restaurantIds: [] }
      const { rows, total } = await listConversations(nobody)
      expect(rows).toEqual([])
      expect(total).toBe(0)
    })
  })

  describe('inbound', () => {
    it('creates the thread, links the newest order, counts unread and opens the window', async () => {
      const p = phone()
      const o = await makeOrder({ restaurantId: ganga, contactPhone: p, contactName: 'Priya' })
      const at = new Date('2026-11-01T06:00:00Z')
      const r = await recordInbound({ ...inbound(`91${p}`, 'Where is my order?', 'wamid.in.A', at), customerName: 'Priya S' })
      expect(r.duplicate).toBe(false)
      const c = await findConversation(telecaller, r.conversationId)
      expect(c).toMatchObject({ customerName: 'Priya S', unreadCount: 1, lastMessageText: 'Where is my order?', lastMessageDirection: 'IN' })
      expect(String(c!.orderId)).toBe(String(o._id))
      expect(String(c!.restaurantId)).toBe(String(ganga))
      expect(c!.lastInboundAt?.toISOString()).toBe(at.toISOString())

      const msgs = await listMessages(telecaller, r.conversationId)
      expect(msgs).toHaveLength(1)
      expect(msgs[0]).toMatchObject({ direction: 'IN', status: 'RECEIVED', text: 'Where is my order?', providerMessageId: 'wamid.in.A' })
    })

    it('is idempotent on the provider message id', async () => {
      const p = `91${phone()}`
      const first = await recordInbound(inbound(p, 'one', 'wamid.in.DUP'))
      const second = await recordInbound(inbound(p, 'one', 'wamid.in.DUP'))
      expect(second).toEqual({ conversationId: first.conversationId, messageId: null, duplicate: true })
      expect(await WaMessage.countDocuments({ conversationId: first.conversationId })).toBe(1)
      expect((await findConversation(admin, first.conversationId))!.unreadCount).toBe(1)
    })

    it('a media message keeps its link and caption', async () => {
      const p = `91${phone()}`
      const r = await recordInbound({ ...inbound(p, null as unknown as string), kind: 'MEDIA', text: null, mediaUrl: 'https://x/y.jpg', mediaCaption: 'seat photo' })
      const c = await findConversation(admin, r.conversationId)
      expect(c!.lastMessageText).toBe('seat photo')
      const [m] = await listMessages(admin, r.conversationId)
      expect(m).toMatchObject({ kind: 'MEDIA', mediaUrl: 'https://x/y.jpg' })
    })
  })

  describe('sending', () => {
    it('refuses free text before the passenger has written, allows the opener template', async () => {
      const fake = new FakeProvider()
      const id = await openConversationForPhone(telecaller, phone())
      await expect(sendText(telecaller, id, 'Hello', fake)).rejects.toThrow(/opener template/)
      expect(fake.texts).toHaveLength(0)

      const o = await makeOrder({ restaurantId: ganga, contactPhone: phone(), externalOrderId: 'FT-OPENER-1' })
      const id2 = await openConversationForOrder(telecaller, String(o._id))
      await sendOpenerTemplate(telecaller, id2, fake, { name: 'order_update', language: 'en' })
      expect(fake.templates[0]).toMatchObject({ name: 'order_update', language: 'en', bodyValues: ['FT-OPENER-1'] })
      // A two-variable opener: passenger name, then order id, in the configured order.
      await sendOpenerTemplate(telecaller, id2, fake, { name: 'support_chat_opener', language: 'en', vars: ['name', 'order'] })
      expect(fake.templates[1].bodyValues).toEqual(['Test Passenger', 'FT-OPENER-1'])
      // The order-confirmation card: every variable filled from the order, none empty.
      const station = await makeStation('CNB', { name: 'KANPUR CENTRAL' })
      void station
      const card = await makeOrder({
        restaurantId: ganga, contactPhone: phone(), externalOrderId: 'FT-CARD-1', amountPaise: 41900,
        stationCode: 'CNB', trainNo: '13350', trainName: 'PNBE SGRL EXP', coach: 'S3', berth: '56', contactName: 'Aman',
      })
      const id3 = await openConversationForOrder(telecaller, String(card._id))
      await sendOpenerTemplate(telecaller, id3, fake, { name: 'order_confirmation', language: 'en', vars: ['name', 'order', 'amount', 'station', 'train', 'seat'] })
      expect(fake.templates[2].bodyValues).toEqual(['Aman', 'FT-CARD-1', '419', 'KANPUR CENTRAL-CNB', 'PNBE SGRL EXP-13350', 'S3-56'])
      // A bare order still fills every slot with something.
      const bare = await makeOrder({ restaurantId: ganga, contactPhone: phone(), amountPaise: null, trainNo: null, coach: null, berth: null, rawSeat: null, contactName: null, stationCode: 'PRYJ' })
      const id4 = await openConversationForOrder(telecaller, String(bare._id))
      await sendOpenerTemplate(telecaller, id4, fake, { name: 'order_confirmation', language: 'en', vars: ['name', 'order', 'amount', 'station', 'train', 'seat'] })
      expect(fake.templates[3].bodyValues.every((v) => v.length > 0)).toBe(true)
      const [, , amount, stationVar, train, seat] = fake.templates[3].bodyValues
      expect([amount, train, seat]).toEqual(['-', '-', '-'])
      // No Station row for PRYJ: the outlet's own station name stands in, code last.
      expect(stationVar.endsWith('-PRYJ')).toBe(true)
      const [m] = await listMessages(telecaller, id2)
      expect(m).toMatchObject({ direction: 'OUT', kind: 'TEMPLATE', templateName: 'order_update', status: 'SENT' })
    })

    it("does not put another outlet's order id into the opener of an unclaimed thread", async () => {
      const fake = new FakeProvider()
      const p = phone()
      // An order with no outlet resolved yet links the thread but claims it for nobody.
      await makeOrder({ restaurantId: null, contactPhone: p, externalOrderId: 'FT-NOBODYS-1' })
      const r = await recordInbound(inbound(`91${p}`, 'hi'))
      const c = await findConversation(telecaller, r.conversationId)
      expect(c!.restaurantId).toBeNull()
      expect(c!.orderId).not.toBeNull()
      await sendOpenerTemplate(telecaller, r.conversationId, fake, { name: 'order_update', language: 'en' })
      expect(fake.templates[0].bodyValues).toEqual(['-'])
    })

    it('does not steal a thread a colleague already holds when replying', async () => {
      const fake = new FakeProvider()
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'hi'))
      await assignConversation(admin, r.conversationId, String(otherTelecaller.userId))
      await sendText(admin, r.conversationId, 'From the admin', fake)
      expect(String((await findConversation(admin, r.conversationId))!.assignedTo)).toBe(String(otherTelecaller.userId))
    })

    it('sends inside the window, records the line as SENT and claims the thread', async () => {
      const fake = new FakeProvider()
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'Hi'))
      const msgId = await sendText(telecaller, r.conversationId, '  Your food reaches the seat in 10 minutes.  ', fake)
      expect(fake.texts).toEqual([{ to: p, text: 'Your food reaches the seat in 10 minutes.' }])

      const msgs = await listMessages(telecaller, r.conversationId)
      expect(msgs.map((m) => m.direction)).toEqual(['IN', 'OUT'])
      expect(msgs[1]).toMatchObject({
        _id: new mongoose.Types.ObjectId(msgId),
        status: 'SENT',
        providerMessageId: expect.stringMatching(/^wamid\.fake\.\d+$/),
        providerRequestId: expect.stringMatching(/^req\.\d+$/),
        text: 'Your food reaches the seat in 10 minutes.',
      })
      expect(String(msgs[1].sentBy)).toBe(String(telecaller.userId))

      const c = await findConversation(telecaller, r.conversationId)
      expect(c).toMatchObject({ lastMessageDirection: 'OUT', lastMessageText: 'Your food reaches the seat in 10 minutes.' })
      expect(String(c!.assignedTo)).toBe(String(telecaller.userId))
    })

    it('refuses free text once 24 hours have passed', async () => {
      const fake = new FakeProvider()
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'Hi', undefined, new Date(Date.now() - SESSION_WINDOW_MS - 1000)))
      await expect(sendText(telecaller, r.conversationId, 'Too late', fake)).rejects.toThrow(/24 hours/)
    })

    it('keeps a failed send in the thread as FAILED with the reason, and rethrows', async () => {
      const fake = new FakeProvider()
      fake.fail = 'MSG91 refused the message: Invalid integrated number'
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'Hi'))
      await expect(sendText(telecaller, r.conversationId, 'Hello', fake)).rejects.toThrow(/Invalid integrated number/)
      const msgs = await listMessages(telecaller, r.conversationId)
      expect(msgs[1]).toMatchObject({ direction: 'OUT', status: 'FAILED', failReason: fake.fail })
    })

    it('refuses an empty message and an out-of-scope thread', async () => {
      const fake = new FakeProvider()
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'Hi'))
      await expect(sendText(telecaller, r.conversationId, '   ', fake)).rejects.toBeInstanceOf(ConflictError)
      const theirs = await openConversationForPhone(otherTelecaller, phone())
      await expect(sendText(telecaller, theirs, 'Hello', fake)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('thread paging', () => {
    it('hands back the newest page, then the page before it, oldest first, until the start', async () => {
      // Opened at the other outlet first, so the thread is claimed there and
      // the scope check at the end has something to refuse.
      const raw = phone()
      const p = `91${raw}`
      const id = await openConversationForPhone(otherTelecaller, raw)
      const base = new Date('2026-11-01T00:00:00Z').getTime()
      for (let i = 0; i < 7; i++) {
        await recordInbound(inbound(p, `m${i}`, `wamid.page.${i}`, new Date(base + i * 60_000)))
      }

      const first = await listMessagesPage(admin, id, { limit: 3 })
      expect(first.rows.map((m) => m.text)).toEqual(['m4', 'm5', 'm6'])
      expect(first.hasMore).toBe(true)

      const second = await listMessagesPage(admin, id, { limit: 3, before: first.rows[0].createdAt })
      expect(second.rows.map((m) => m.text)).toEqual(['m1', 'm2', 'm3'])
      expect(second.hasMore).toBe(true)

      const third = await listMessagesPage(admin, id, { limit: 3, before: second.rows[0].createdAt })
      expect(third.rows.map((m) => m.text)).toEqual(['m0'])
      expect(third.hasMore).toBe(false)

      // Exactly a page left says "no more" rather than offering an empty page.
      const exact = await listMessagesPage(admin, id, { limit: 7 })
      expect(exact.rows).toHaveLength(7)
      expect(exact.hasMore).toBe(false)

      await expect(listMessagesPage(telecaller, id)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('status reports', () => {
    it('move forward only, by wamid or request id, and FAILED wins', async () => {
      const fake = new FakeProvider()
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'Hi'))
      await sendText(telecaller, r.conversationId, 'One', fake)
      const [, out] = await listMessages(telecaller, r.conversationId)
      const at = new Date()

      expect(await applyStatus({ type: 'status', providerMessageId: out.providerMessageId!, providerRequestId: null, status: 'READ', reason: null, at })).toBe(true)
      // A late "delivered" after "read" changes nothing.
      expect(await applyStatus({ type: 'status', providerMessageId: out.providerMessageId!, providerRequestId: null, status: 'DELIVERED', reason: null, at })).toBe(false)
      expect((await listMessages(telecaller, r.conversationId))[1].status).toBe('READ')

      // By request id alone, as MSG91 reports before the wamid is known.
      expect(await applyStatus({ type: 'status', providerMessageId: null, providerRequestId: out.providerRequestId!, status: 'FAILED', reason: 'blocked', at })).toBe(true)
      expect((await listMessages(telecaller, r.conversationId))[1]).toMatchObject({ status: 'FAILED', failReason: 'blocked' })

      expect(await applyStatus({ type: 'status', providerMessageId: 'wamid.nobody', providerRequestId: null, status: 'READ', reason: null, at })).toBe(false)
    })

    it('never resurrect a FAILED message with a late delivery or read report', async () => {
      const fake = new FakeProvider()
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'Hi'))
      await sendText(telecaller, r.conversationId, 'One', fake)
      const [, out] = await listMessages(telecaller, r.conversationId)
      const at = new Date()
      await applyStatus({ type: 'status', providerMessageId: out.providerMessageId!, providerRequestId: null, status: 'FAILED', reason: 'blocked', at })
      expect(await applyStatus({ type: 'status', providerMessageId: out.providerMessageId!, providerRequestId: null, status: 'DELIVERED', reason: null, at })).toBe(false)
      expect(await applyStatus({ type: 'status', providerMessageId: out.providerMessageId!, providerRequestId: null, status: 'READ', reason: null, at })).toBe(false)
      expect((await listMessages(telecaller, r.conversationId))[1]).toMatchObject({ status: 'FAILED', failReason: 'blocked' })
    })

    it('bump the thread version so the live feed notices', async () => {
      const fake = new FakeProvider()
      const p = `91${phone()}`
      const r = await recordInbound(inbound(p, 'Hi'))
      await sendText(telecaller, r.conversationId, 'One', fake)
      const before = await chatVersion(telecaller, r.conversationId)
      await new Promise((res) => setTimeout(res, 5))
      const [, out] = await listMessages(telecaller, r.conversationId)
      await applyStatus({ type: 'status', providerMessageId: out.providerMessageId!, providerRequestId: null, status: 'DELIVERED', reason: null, at: new Date() })
      const after = await chatVersion(telecaller, r.conversationId)
      expect(after.threadAt).not.toBe(before.threadAt)
    })
  })

  describe('reading, unread and assignment', () => {
    it('counts unread across scope and clears on markRead', async () => {
      await WaConversation.updateMany({}, { $set: { unreadCount: 0 } })
      const a = await recordInbound(inbound(`91${phone()}`, 'a'))
      await recordInbound(inbound(a.conversationId && `91${phone()}`, 'b'))
      const mineBefore = await countUnread(telecaller)
      expect(mineBefore).toBe(2)
      await markRead(telecaller, a.conversationId)
      expect(await countUnread(telecaller)).toBe(1)
      expect((await findConversation(telecaller, a.conversationId))!.unreadCount).toBe(0)
    })

    it('a telecaller can take or release, not hand to a colleague; an admin can', async () => {
      const id = await openConversationForPhone(telecaller, phone())
      await assignConversation(telecaller, id, String(telecaller.userId))
      expect(String((await findConversation(telecaller, id))!.assignedTo)).toBe(String(telecaller.userId))
      await expect(assignConversation(telecaller, id, String(otherTelecaller.userId))).rejects.toBeInstanceOf(ForbiddenError)
      await assignConversation(telecaller, id, null)
      expect((await findConversation(telecaller, id))!.assignedTo).toBeNull()
      await assignConversation(admin, id, String(otherTelecaller.userId))
      expect(String((await findConversation(admin, id))!.assignedTo)).toBe(String(otherTelecaller.userId))
      await expect(assignConversation(admin, id, String(manager.userId))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('lists who a thread can go to, for admins only', async () => {
      const users = await listAssignableChatUsers(admin)
      const ids = users.map((u) => u.id)
      expect(ids).toContain(String(telecaller.userId))
      expect(ids).toContain(String(otherTelecaller.userId))
      expect(ids).toContain(String(admin.userId))
      expect(ids).not.toContain(String(manager.userId))
      expect(ids).not.toContain(String(rider.userId))
      await expect(listAssignableChatUsers(telecaller)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it("the admin's Unassigned filter lists only threads nobody holds", async () => {
      const taken = await openConversationForPhone(telecaller, phone())
      await assignConversation(telecaller, taken, String(telecaller.userId))
      const free = await openConversationForPhone(telecaller, phone())
      const { rows } = await listConversations(admin, { filter: 'unassigned', limit: 200 })
      const ids = rows.map((c) => String(c._id))
      expect(ids).toContain(free)
      expect(ids).not.toContain(taken)
      expect(rows.every((c) => c.assignedTo === null)).toBe(true)
    })

    it("a telecaller cannot take or release a colleague's thread, and an admin cannot assign to a deactivated or junk user", async () => {
      const id = await openConversationForPhone(telecaller, phone())
      await assignConversation(admin, id, String(otherTelecaller.userId))
      // otherTelecaller holds it; the thread is at Ganga though, so make a second Ganga telecaller to try.
      const colleague = ctxFor(await makeUser('TELECALLER', '9200000099', ganga))
      await expect(assignConversation(colleague, id, String(colleague.userId))).rejects.toBeInstanceOf(ForbiddenError)
      await expect(assignConversation(colleague, id, null)).rejects.toBeInstanceOf(ForbiddenError)
      expect(String((await findConversation(admin, id))!.assignedTo)).toBe(String(otherTelecaller.userId))

      await expect(assignConversation(admin, id, 'bob')).rejects.toBeInstanceOf(NotFoundError)
      const retired = await makeUser('TELECALLER', '9200000098', ganga)
      await retired.updateOne({ active: false })
      await expect(assignConversation(admin, id, String(retired._id))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('filters the list by unread, mine and a search', async () => {
      const p = phone()
      const r = await recordInbound({ ...inbound(`91${p}`, 'find me'), customerName: 'Zubin Searchable' })
      await assignConversation(telecaller, r.conversationId, String(telecaller.userId))

      const unread = await listConversations(telecaller, { filter: 'unread', limit: 100 })
      expect(unread.rows.map((c) => String(c._id))).toContain(r.conversationId)
      expect(unread.rows.every((c) => c.unreadCount > 0)).toBe(true)

      const mine = await listConversations(telecaller, { filter: 'mine', limit: 100 })
      expect(mine.rows.every((c) => String(c.assignedTo) === String(telecaller.userId))).toBe(true)

      const byName = await listConversations(telecaller, { q: 'zubin', limit: 100 })
      expect(byName.rows.map((c) => String(c._id))).toEqual([r.conversationId])
      const byNumber = await listConversations(telecaller, { q: `${p.slice(0, 5)} ${p.slice(5)}`, limit: 100 })
      expect(byNumber.rows.map((c) => String(c._id))).toEqual([r.conversationId])
    })

    it('pages the list, newest activity first', async () => {
      const first = await listConversations(admin, { skip: 0, limit: 2 })
      const second = await listConversations(admin, { skip: 2, limit: 2 })
      expect(first.rows).toHaveLength(2)
      expect(first.total).toBeGreaterThan(4)
      expect(first.rows.map((c) => String(c._id))).not.toEqual(second.rows.map((c) => String(c._id)))
      const times = first.rows.map((c) => (c.lastMessageAt ?? c.createdAt).getTime())
      expect(times[0]).toBeGreaterThanOrEqual(times[1])
    })
  })

  describe('simulator', () => {
    it('reports delivered, read, then a reply, through the callbacks it is given', async () => {
      const statuses: string[] = []
      let reply: { to: string; text: string } | null = null
      const sim = new SimulatedWhatsAppProvider(
        {
          onStatus: async (_id, s) => void statuses.push(s),
          onReply: async (to, text) => void (reply = { to, text }),
        },
        5,
      )
      const out = await sim.sendText('919800000001', 'hello')
      expect(out.providerMessageId).toMatch(/^sim\./)
      await new Promise((res) => setTimeout(res, 60))
      expect(statuses).toEqual(['DELIVERED', 'READ'])
      expect(reply).toMatchObject({ to: '919800000001' })
    })
  })
})
