import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env'

/*
 * Small, boring crypto for the Gmail linking:
 *  - seal/open: AES-256-GCM for a mailbox's Google token at rest;
 *  - sign/verify: an HMAC-signed, expiring value for the OAuth `state`, so a
 *    callback can only finish a link the same signed-in admin started.
 */

function key(): Buffer {
  const secret = env.MAILBOX_TOKEN_KEY || `mailbox-token:${env.AUTH_SECRET}`
  return createHash('sha256').update(secret).digest()
}

/** Encrypts a secret for storage: "v1.<iv>.<tag>.<data>", all base64url. */
export function seal(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

/** Decrypts what seal() produced; throws if it was altered or the key changed. */
export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable sealed value')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

const hmac = (body: string) => createHmac('sha256', `oauth-state:${env.AUTH_SECRET}`).update(body).digest('base64url')

/** A signed value that expires: "<payload>.<signature>". */
export function sign(payload: Record<string, unknown>, ttlMs: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs })).toString('base64url')
  return `${body}.${hmac(body)}`
}

/** The payload, if the signature is ours and it has not expired; otherwise null. */
export function verify<T extends Record<string, unknown>>(value: string, now = Date.now()): T | null {
  const [body, sig] = value.split('.')
  if (!body || !sig) return null
  const expected = Buffer.from(hmac(body))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number }
    if (typeof payload.exp !== 'number' || payload.exp < now) return null
    return payload
  } catch {
    return null
  }
}
