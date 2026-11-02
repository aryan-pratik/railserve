import { randomUUID } from 'node:crypto'
import type { SendResult, TemplateSend, WhatsAppProvider } from './provider'

/**
 * A pretend passenger.
 *
 * Every message a telecaller sends is "delivered", then "read", then
 * answered a moment later, so the chat screen can be worked end to end with
 * no MSG91 account and no phone. The replies are deliberately dull: this is a
 * stand-in for the transport, not a chatbot.
 *
 * The callbacks are injected rather than imported so that this file knows
 * nothing about the database — the repository wires them up in ./index.ts,
 * and the test suite can pass a provider with none at all.
 */
export type SimulatorEvents = {
  onStatus?: (providerMessageId: string, status: 'DELIVERED' | 'READ') => Promise<void>
  onReply?: (to: string, text: string, providerMessageId: string) => Promise<void>
}

const REPLIES = [
  'Ok, thank you.',
  'Please deliver to the seat, I am there.',
  'How long will it take?',
  'Thanks, got it.',
  'Can you make it less spicy?',
]

export class SimulatedWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'simulator' as const

  constructor(
    private readonly events: SimulatorEvents = {},
    private readonly delayMs = 1500,
  ) {}

  async sendText(to: string, text: string): Promise<SendResult> {
    const id = `sim.${randomUUID()}`
    this.schedule(to, id, text)
    return { providerMessageId: id, providerRequestId: null }
  }

  /** A plausible body, so the thread shows a filled-in message offline too. */
  async templateBody(name: string): Promise<string | null> {
    return `Hi {{1}}, this is the support team about your order {{2}}. Reply to this message and we will help you right away. (${name})`
  }

  async sendTemplate(send: TemplateSend): Promise<SendResult> {
    const id = `sim.${randomUUID()}`
    this.schedule(send.to, id, `template ${send.name}`)
    return { providerMessageId: id, providerRequestId: null }
  }

  private schedule(to: string, id: string, text: string) {
    if (this.delayMs <= 0) return
    const { onStatus, onReply } = this.events
    const run = async () => {
      await onStatus?.(id, 'DELIVERED')
      await onStatus?.(id, 'READ')
      const reply = REPLIES[Math.abs(hash(text)) % REPLIES.length]
      await onReply?.(to, reply, `sim.${randomUUID()}`)
    }
    const timer = setTimeout(() => {
      run().catch((err) => console.error('[whatsapp-simulator]', err))
    }, this.delayMs)
    // Never keep a process alive for a pretend passenger.
    timer.unref?.()
  }
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
