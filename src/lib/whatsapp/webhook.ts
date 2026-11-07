import { normalisePhone } from './phone'

/**
 * What MSG91 posts to the webhook, reduced to the two things the chat cares
 * about: a message the passenger sent, or a report on one we sent.
 *
 * MSG91 has two webhook generations and they disagree on everything but
 * intent — the new one is camelCase with `eventName`, the old one snake_case
 * with `direction: "inbound"` — and both stringify nested JSON inside string
 * fields. This parser reads either, so a dashboard reconfiguration does not
 * silently stop the inbox. Shapes confirmed against msg91.com/help on
 * 2026-11-01; see docs/WHATSAPP.md for the samples.
 */

export type InboundEvent = {
  type: 'inbound'
  phone: string
  customerName: string | null
  providerMessageId: string
  kind: 'TEXT' | 'MEDIA' | 'OTHER'
  text: string | null
  /** The quick-reply button or list option the passenger tapped, if that is what this is. */
  button: string | null
  mediaUrl: string | null
  mediaCaption: string | null
  /** WhatsApp's own word for the attachment (image, video, audio, document…). */
  mediaType?: string | null
  at: Date
}

export type StatusEvent = {
  type: 'status'
  providerMessageId: string | null
  providerRequestId: string | null
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  reason: string | null
  at: Date
}

export type WebhookEvent = InboundEvent | StatusEvent

type Json = Record<string, unknown>

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker', 'voice'])

function str(v: unknown): string | null {
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/** Reads a field under either of its two spellings. */
function field(body: Json, camel: string, snake: string): string | null {
  return str(body[camel]) ?? str(body[snake])
}

/** MSG91 nests JSON inside strings; parse if it looks like one. */
function nested(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return v
  try {
    return JSON.parse(t)
  } catch {
    return v
  }
}

function when(body: Json): Date {
  const raw = field(body, 'ts', 'submitted_at') ?? field(body, 'requestedAt', 'delivered_at')
  if (raw) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

const STATUS_WORDS: Record<string, StatusEvent['status']> = {
  sent: 'SENT',
  submitted: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
  undelivered: 'FAILED',
  rejected: 'FAILED',
}

export function parseMsg91Webhook(input: unknown): WebhookEvent | null {
  if (!input || typeof input !== 'object') return null
  const body = input as Json

  const phone = normalisePhone(field(body, 'customerNumber', 'customer_number'))
  if (!phone) return null

  // Inbound: the new webhook marks it with `direction: "0"` and the message
  // content fields; the old one says `direction: "inbound"`. The presence
  // of `messages` (the raw Meta array) is the most reliable tell of all.
  const direction = field(body, 'direction', 'direction')?.toLowerCase() ?? null
  const messages = nested(body.messages)
  const inbound =
    direction === 'inbound' ||
    direction === '0' ||
    (Array.isArray(messages) && messages.length > 0) ||
    (direction === null && (str(body.text) !== null || str(body.contentType) !== null) && !str(body.eventName))

  if (inbound) return parseInbound(body, phone, messages)
  return parseStatus(body)
}

function parseInbound(body: Json, phone: string, messages: unknown): InboundEvent | null {
  const first = Array.isArray(messages) && messages[0] && typeof messages[0] === 'object'
    ? (messages[0] as Json)
    : null

  const providerMessageId =
    str(first?.id) ?? field(body, 'uuid', 'message_uuid') ?? field(body, 'requestId', 'request_id')
  if (!providerMessageId) return null

  const contentType =
    (field(body, 'contentType', 'message_type') ?? str(first?.type) ?? 'text').toLowerCase()

  // Text lives in `text` on the new shape, inside `content` on the old one,
  // and in messages[0].text.body on the raw Meta array.
  const content = nested(body.content)
  const textFromContent =
    typeof content === 'string'
      ? content
      : content && typeof content === 'object'
        ? str((content as Json).text) ?? str(((content as Json).body as Json | undefined)?.text)
        : null
  const metaText = first && first.text && typeof first.text === 'object' ? str((first.text as Json).body) : null

  // A tap on a template's quick-reply button, or on an interactive reply or
  // list option, arrives as its own message type with the label in a
  // different place for each. The label is what the telecaller should read.
  const button = buttonLabel(body, first)
  const text = str(body.text) ?? metaText ?? textFromContent ?? button

  const media = MEDIA_TYPES.has(contentType)
  const mediaUrl = media ? str(body.url) ?? str((first?.[contentType] as Json | undefined)?.link) : null
  const mediaCaption = media
    ? str(body.caption) ?? str(body.filename) ?? str((first?.[contentType] as Json | undefined)?.caption)
    : null

  const customerName =
    str(body.customerName) ??
    (() => {
      const contacts = nested(body.contacts)
      const c = Array.isArray(contacts) ? (contacts[0] as Json | undefined) : null
      return c?.profile && typeof c.profile === 'object' ? str((c.profile as Json).name) : null
    })()

  return {
    type: 'inbound',
    phone,
    customerName,
    providerMessageId,
    kind: contentType === 'text' || button ? 'TEXT' : media ? 'MEDIA' : 'OTHER',
    text,
    button,
    mediaUrl,
    mediaCaption,
    mediaType: media ? contentType : null,
    at: when(body),
  }
}

function buttonLabel(body: Json, first: Json | null): string | null {
  // New webhook: `button` is the label, or a JSON string {text, payload}.
  const raw = nested(body.button)
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (raw && typeof raw === 'object') {
    const b = raw as Json
    const t = str(b.text) ?? str(b.title) ?? str(b.payload)
    if (t) return t
  }
  // Interactive replies: {type: 'button_reply'|'list_reply', button_reply: {title}, list_reply: {title}}.
  const inter = nested(body.interactive) ?? first?.interactive
  if (inter && typeof inter === 'object') {
    const i = inter as Json
    for (const k of ['button_reply', 'list_reply']) {
      const r = i[k]
      if (r && typeof r === 'object') {
        const t = str((r as Json).title) ?? str((r as Json).id)
        if (t) return t
      }
    }
  }
  // Raw Meta message: {type: 'button', button: {text, payload}}.
  if (first?.button && typeof first.button === 'object') {
    const t = str((first.button as Json).text) ?? str((first.button as Json).payload)
    if (t) return t
  }
  return null
}

function parseStatus(body: Json): StatusEvent | null {
  const word = (field(body, 'eventName', 'status') ?? '').toLowerCase()
  const status = STATUS_WORDS[word]
  if (!status) return null

  const providerMessageId = field(body, 'uuid', 'message_uuid')
  const providerRequestId = field(body, 'requestId', 'request_id')
  if (!providerMessageId && !providerRequestId) return null

  return {
    type: 'status',
    providerMessageId,
    providerRequestId,
    status,
    reason: status === 'FAILED' ? field(body, 'reason', 'reason') : null,
    at: when(body),
  }
}
