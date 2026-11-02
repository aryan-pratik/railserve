import { env } from '../env'
import { WhatsAppSendError, type SendResult, type TemplateSend, type WhatsAppProvider } from './provider'

/**
 * MSG91's WhatsApp Business API.
 *
 * Two endpoints, verified against docs.msg91.com (WhatsApp → "Send Message
 * (once Session Started)" and "Send WhatsApp Template") on 2026-11-01:
 *
 *   POST {MSG91_API_URL}/whatsapp-outbound-message/
 *        integrated_number, recipient_number, content_type=text, text
 *        — a free-text message inside the 24-hour window. The reference
 *        documents these as query parameters with no body; the group variant
 *        of the same call takes them as JSON. Both are sent, so whichever
 *        reading MSG91 applies, the fields are there.
 *
 *   POST {MSG91_API_URL}/whatsapp-outbound-message/bulk/
 *        { integrated_number, content_type: "template", payload: { … } }
 *        — a template, allowed at any time.
 *
 * Both authenticate with an `authkey` header. Everything else MSG91 offers
 * (media, interactive buttons, catalogues) is deliberately not here yet.
 */

const TIMEOUT_MS = 15_000
/** Template bodies change only when someone edits them in the dashboard. */
const TEMPLATE_CACHE_MS = 60 * 60 * 1000

type FetchLike = typeof fetch

export class Msg91Provider implements WhatsAppProvider {
  readonly name = 'msg91' as const

  constructor(
    private readonly opts: {
      authKey: string
      integratedNumber: string
      baseUrl: string
      /** The WABA's template namespace; omitted from the payload when blank. */
      namespace?: string
      fetchImpl?: FetchLike
    },
  ) {}

  async sendText(to: string, text: string): Promise<SendResult> {
    const fields = {
      integrated_number: this.opts.integratedNumber,
      recipient_number: to,
      content_type: 'text',
      text,
    }
    const url = new URL(`${this.opts.baseUrl.replace(/\/$/, '')}/whatsapp-outbound-message/`)
    for (const [k, v] of Object.entries(fields)) url.searchParams.set(k, v)
    return this.post(url.toString(), fields)
  }

  private templateCache = new Map<string, { body: string | null; at: number }>()

  /**
   * GET {baseUrl}/get-template-client/{integrated_number}?template_name=…
   * — the dashboard's own template list. The body is the BODY component's
   * text for the requested language.
   */
  async templateBody(name: string, language: string): Promise<string | null> {
    const key = `${name}:${language}`
    const hit = this.templateCache.get(key)
    if (hit && Date.now() - hit.at < TEMPLATE_CACHE_MS) return hit.body
    let body: string | null = null
    try {
      const fetchImpl = this.opts.fetchImpl ?? fetch
      const url = `${this.opts.baseUrl.replace(/\/$/, '')}/get-template-client/${this.opts.integratedNumber}?template_name=${encodeURIComponent(name)}`
      const res = await fetchImpl(url, {
        headers: { authkey: this.opts.authKey, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.ok) body = extractBody((await res.json()) as unknown, name, language)
    } catch {
      body = null
    }
    // A miss is cached too: one failed lookup must not become one per send.
    this.templateCache.set(key, { body, at: Date.now() })
    return body
  }

  async sendTemplate(send: TemplateSend): Promise<SendResult> {
    const components: Record<string, { type: 'text'; value: string }> = {}
    send.bodyValues.forEach((value, i) => {
      components[`body_${i + 1}`] = { type: 'text', value }
    })
    const body = {
      integrated_number: this.opts.integratedNumber,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: send.name,
          language: { code: send.language, policy: 'deterministic' },
          ...(this.opts.namespace ? { namespace: this.opts.namespace } : {}),
          to_and_components: [{ to: [send.to], components }],
        },
      },
    }
    return this.post(`${this.opts.baseUrl.replace(/\/$/, '')}/whatsapp-outbound-message/bulk/`, body)
  }

  private async post(url: string, body: unknown): Promise<SendResult> {
    const fetchImpl = this.opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authkey: this.opts.authKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new WhatsAppSendError(
        err instanceof Error && err.name === 'TimeoutError'
          ? 'MSG91 did not answer in time. The message was not sent.'
          : 'Could not reach MSG91. The message was not sent.',
      )
    }

    const raw = await res.text()
    let json: Record<string, unknown> | null = null
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : {}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
    } catch {
      json = null
    }
    // An HTML error page or a gateway's plain text behind a 200 is not a
    // send: nothing in it could ever be matched to a status report.
    if (json === null) {
      throw new WhatsAppSendError(`MSG91 answered with something other than JSON (HTTP ${res.status}). The message was not sent.`)
    }

    // MSG91 answers 200 with {"status":"fail"} as often as with a 4xx, so the
    // body is checked as well as the code.
    const status = typeof json.status === 'string' ? json.status.toLowerCase() : ''
    if (!res.ok || status === 'fail' || status === 'error' || json.hasError === true) {
      throw new WhatsAppSendError(msg91Reason(json, res.status))
    }

    return {
      providerMessageId: pickString(json, ['message_id', 'messageId', 'uuid', 'wamid']),
      providerRequestId: pickString(json, ['request_id', 'requestId', 'id']),
    }
  }
}

/** The BODY text out of MSG91's template listing, for one template and language. */
export function extractBody(json: unknown, name: string, language: string): string | null {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return null
  for (const t of data as Record<string, unknown>[]) {
    if (t.name !== name) continue
    const langs = Array.isArray(t.languages) ? (t.languages as Record<string, unknown>[]) : []
    const lang = langs.find((l) => l.language === language) ?? langs[0]
    const code = Array.isArray(lang?.code) ? (lang!.code as Record<string, unknown>[]) : []
    const bodyPart = code.find((c) => c.type === 'BODY')
    return typeof bodyPart?.text === 'string' ? bodyPart.text : null
  }
  return null
}

function pickString(json: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = json[k]
    if (typeof v === 'string' && v) return v
  }
  // Some MSG91 responses nest the useful part under `data`.
  const data = json.data
  if (data && typeof data === 'object') return pickString(data as Record<string, unknown>, keys)
  return null
}

function msg91Reason(json: Record<string, unknown>, httpStatus: number): string {
  const msg = json.message ?? json.errors ?? json.error ?? json.msg
  const detail =
    typeof msg === 'string'
      ? msg
      : msg && typeof msg === 'object'
        ? JSON.stringify(msg)
        : `HTTP ${httpStatus}`
  return `MSG91 refused the message: ${detail}`
}

export function msg91FromEnv(fetchImpl?: FetchLike): Msg91Provider {
  return new Msg91Provider({
    authKey: env.MSG91_AUTH_KEY,
    integratedNumber: env.MSG91_WHATSAPP_NUMBER,
    baseUrl: env.MSG91_API_URL,
    namespace: env.MSG91_TEMPLATE_NAMESPACE,
    fetchImpl,
  })
}
