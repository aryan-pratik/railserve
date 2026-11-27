import { google } from 'googleapis'
import { env } from './env'

/*
 * Plain-text email from RailServe, sent through Gmail with the separate
 * SENDING token (GMAIL_SEND_REFRESH_TOKEN, send-only scope). The token that
 * reads orders is never used to send.
 */

export function isMailerConfigured(): boolean {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_SEND_REFRESH_TOKEN)
}

/** "=?UTF-8?B?...?=": a header any mail client reads, whatever the characters. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)

/** The raw message Gmail sends, base64url. Exported for tests. */
export function buildMessage(to: string, subject: string, text: string): string {
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) throw new Error('Line break in a header')
  const body = Buffer.from(`${text}\n\n—\nRailServe`, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')
  // No From line: Gmail fills in the sending account's own address.
  const raw = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
  return Buffer.from(raw, 'utf8').toString('base64url')
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!isMailerConfigured()) throw new Error('Sending is not set up (GMAIL_SEND_REFRESH_TOKEN)')
  const auth = new google.auth.OAuth2(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: env.GMAIL_SEND_REFRESH_TOKEN })
  await google.gmail({ version: 'v1', auth }).users.messages.send({ userId: 'me', requestBody: { raw: buildMessage(to, subject, text) } })
}
