import { env } from '../env'
import { msg91FromEnv } from './msg91'
import { SimulatedWhatsAppProvider } from './simulator'
import type { WhatsAppProvider } from './provider'

/**
 * The provider the app sends through, chosen once from the environment.
 *
 * Mirrors src/lib/train/index.ts: `simulator` by default, the real thing
 * only when both asked for and configured, so a half-filled .env never sends
 * a passenger a real message by accident — or silently sends nothing.
 */
let cached: WhatsAppProvider | null = null

export function isWhatsAppSimulated(): boolean {
  return env.WHATSAPP_PROVIDER === 'simulator' || !env.MSG91_AUTH_KEY || !env.MSG91_WHATSAPP_NUMBER
}

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached
  if (isWhatsAppSimulated()) {
    cached = new SimulatedWhatsAppProvider({
      // Imported lazily so the provider module stays free of the database;
      // the repository imports the provider type, not the other way round.
      onStatus: async (providerMessageId, status) => {
        const { applyStatus } = await import('../repo/whatsappRepo')
        await applyStatus({ type: 'status', providerMessageId, providerRequestId: null, status, reason: null, at: new Date() })
      },
      onReply: async (to, text, providerMessageId) => {
        const { recordInbound } = await import('../repo/whatsappRepo')
        await recordInbound({
          type: 'inbound',
          phone: to,
          customerName: null,
          providerMessageId,
          kind: 'TEXT',
          text,
          mediaUrl: null,
          mediaCaption: null,
          at: new Date(),
        })
      },
    })
  } else {
    cached = msg91FromEnv()
  }
  return cached
}

export const OPENER_VARS = ['name', 'order', 'outlet'] as const
export type OpenerVar = (typeof OPENER_VARS)[number]

export type OpenerTemplate = { name: string; language: string; vars: OpenerVar[] }

/** The template that opens a conversation, or null when none is configured. */
export function openerTemplate(): OpenerTemplate | null {
  // The simulator accepts any template name, so the screen can show the
  // button offline too.
  const name = env.MSG91_OPENER_TEMPLATE || (isWhatsAppSimulated() ? 'order_update' : '')
  if (!name) return null
  const vars = env.MSG91_OPENER_TEMPLATE_VARS.split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is OpenerVar => (OPENER_VARS as readonly string[]).includes(v))
  return { name, language: env.MSG91_OPENER_TEMPLATE_LANG || 'en', vars }
}
