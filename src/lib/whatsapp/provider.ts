/**
 * What the chat needs from a WhatsApp API, and nothing else.
 *
 * Two implementations: MSG91 for production and a simulator for development
 * and the test suite, picked in ./index.ts from the environment. The
 * repository only ever sees this interface, so swapping MSG91 for the Meta
 * Cloud API later is one new file, not a rewrite.
 */

export type SendResult = {
  /** WhatsApp's `wamid.…`, when the provider returns it synchronously. */
  providerMessageId: string | null
  /** The provider's own request/transaction id, for matching status reports. */
  providerRequestId: string | null
}

export type TemplateSend = {
  to: string
  name: string
  language: string
  /** Positional body variables, {{1}}, {{2}}… in order. */
  bodyValues: string[]
}

export interface WhatsAppProvider {
  readonly name: 'msg91' | 'simulator'
  /** A free-text message inside the 24-hour customer-service window. */
  sendText(to: string, text: string): Promise<SendResult>
  /** A pre-approved template, allowed at any time. */
  sendTemplate(send: TemplateSend): Promise<SendResult>
  /**
   * The template's body text with its `{{n}}` placeholders, so the thread can
   * show what the passenger actually received rather than the template's
   * name. Null when the provider cannot say; the thread then falls back to a
   * one-line description.
   */
  templateBody?(name: string, language: string): Promise<string | null>
}

export class WhatsAppSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhatsAppSendError'
  }
}
