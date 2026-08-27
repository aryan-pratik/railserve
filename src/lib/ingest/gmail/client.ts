import { google, type gmail_v1 } from 'googleapis'
import { env } from '../../env'

/**
 * Gmail transport (plan §6). Entirely optional: with no credentials the app
 * runs and ingestion happens by pasting an email at /admin/inbox.
 */
export function isGmailConfigured(): boolean {
  return Boolean(
    env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN,
  )
}

export function gmailClient(): gmail_v1.Gmail {
  if (!isGmailConfigured()) {
    throw new Error('Gmail is not configured — set GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN')
  }
  const auth = new google.auth.OAuth2(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

/**
 * Extracts the plain-text body from a Gmail message payload.
 *
 * Walks the MIME tree rather than assuming a shape: aggregators send
 * multipart/alternative, and the text/plain part is not reliably first.
 * Falls back to stripping tags from text/html, because a parser failure that
 * lands in the unparsed inbox beats dropping the message.
 */
export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return ''

  const decode = (data?: string | null) =>
    data ? Buffer.from(data, 'base64url').toString('utf8') : ''

  const walk = (part: gmail_v1.Schema$MessagePart, mime: string): string | null => {
    if (part.mimeType === mime && part.body?.data) return decode(part.body.data)
    for (const child of part.parts ?? []) {
      const found = walk(child, mime)
      if (found) return found
    }
    return null
  }

  const plain = walk(payload, 'text/plain')
  if (plain) return plain

  const html = walk(payload, 'text/html')
  if (html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  return decode(payload.body?.data)
}

export function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | null {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null
}
