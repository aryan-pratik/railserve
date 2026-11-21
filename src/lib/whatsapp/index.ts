import type { Types } from 'mongoose'
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
      // The number is env-configured, so its events are the primary tenant's.
      onStatus: async (providerMessageId, status) => {
        const { applyStatus } = await import('../repo/whatsappRepo')
        const { getPrimaryTenantId } = await import('../tenancy/primary')
        await applyStatus(await getPrimaryTenantId(), { type: 'status', providerMessageId, providerRequestId: null, status, reason: null, at: new Date() })
      },
      onReply: async (to, text, providerMessageId) => {
        const { recordInbound } = await import('../repo/whatsappRepo')
        const { getPrimaryTenantId } = await import('../tenancy/primary')
        await recordInbound(await getPrimaryTenantId(), {
          type: 'inbound',
          phone: to,
          customerName: null,
          providerMessageId,
          kind: 'TEXT',
          text,
          button: null,
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

/**
 * The provider for one tenant. Only the primary tenant owns the
 * env-configured MSG91 number; every other company chats through its own
 * simulator until it connects a number of its own, so a second company's
 * staff can never message passengers from ours.
 */
const perTenant = new Map<string, WhatsAppProvider>()

export async function whatsAppProviderFor(tenantId: Types.ObjectId): Promise<WhatsAppProvider> {
  const { getPrimaryTenantId } = await import('../tenancy/primary')
  if ((await getPrimaryTenantId()).equals(tenantId)) return getWhatsAppProvider()
  const key = String(tenantId)
  let p = perTenant.get(key)
  if (!p) {
    p = new SimulatedWhatsAppProvider({
      onStatus: async (providerMessageId, status) => {
        const { applyStatus } = await import('../repo/whatsappRepo')
        await applyStatus(tenantId, { type: 'status', providerMessageId, providerRequestId: null, status, reason: null, at: new Date() })
      },
      onReply: async (to, text, providerMessageId) => {
        const { recordInbound } = await import('../repo/whatsappRepo')
        await recordInbound(tenantId, {
          type: 'inbound', phone: to, customerName: null, providerMessageId, kind: 'TEXT', text,
          button: null, mediaUrl: null, mediaCaption: null, at: new Date(),
        })
      },
    })
    perTenant.set(key, p)
  }
  return p
}

/** True when this tenant's chat reaches no real phone. */
export async function isWhatsAppSimulatedFor(tenantId: Types.ObjectId): Promise<boolean> {
  const { getPrimaryTenantId } = await import('../tenancy/primary')
  return !(await getPrimaryTenantId()).equals(tenantId) || isWhatsAppSimulated()
}

export const OPENER_VARS = ['name', 'order', 'amount', 'station', 'train', 'seat', 'outlet'] as const
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
