import { createHmac, timingSafeEqual } from 'node:crypto'
import mongoose from 'mongoose'
import { env } from '../env'
import { connectDb } from '../db'
import { User } from '../models'
import type { AuthContext } from '../authContext'
import type { Role } from '../roles'

/**
 * Bearer tokens for the Expo app.
 *
 * Auth.js issues an httpOnly session cookie, which a React Native client cannot
 * carry usefully. Rather than bolt a second identity system on, this signs the
 * same claims with the same AUTH_SECRET and hands back a bearer token — one
 * source of truth for who a user is, two transports.
 *
 * Signed and verified locally (HMAC), so validating a request costs no database
 * round trip; the role and outlet still come from the token and are re-checked
 * against the user record on every call that matters.
 */
const TOKEN_TTL_DAYS = 30

type TokenPayload = {
  sub: string
  role: Role
  restaurantIds: string[]
  name: string
  exp: number
}

function sign(data: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(data).digest('base64url')
}

export function issueMobileToken(user: {
  _id: mongoose.Types.ObjectId
  role: Role
  restaurantIds?: mongoose.Types.ObjectId[] | null
  name: string
}): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const payload: TokenPayload = {
    sub: String(user._id),
    role: user.role,
    restaurantIds: (user.restaurantIds ?? []).map(String),
    name: user.name,
    exp: Math.floor(expiresAt.getTime() / 1000),
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { token: `${body}.${sign(body)}`, expiresAt }
}

export function verifyMobileToken(token: string): TokenPayload | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = sign(body)
  // Constant-time compare: a fast-fail comparison leaks the signature a byte
  // at a time to anyone willing to time the endpoint.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Resolves an Authorization header to an AuthContext.
 *
 * Re-reads the user so a deactivated account or a changed role takes effect
 * immediately rather than at token expiry — 30 days is far too long to leave a
 * revoked agent able to mark orders delivered.
 */
export async function contextFromBearer(request: Request): Promise<AuthContext | null> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null

  const payload = verifyMobileToken(header.slice(7).trim())
  if (!payload) return null

  await connectDb()
  const user = await User.findOne({ _id: payload.sub, active: true })
    .select('role restaurantIds')
    .lean()
  if (!user) return null

  return {
    userId: new mongoose.Types.ObjectId(payload.sub),
    role: user.role as Role,
    restaurantIds: (user.restaurantIds ?? []).map(
      (id) => new mongoose.Types.ObjectId(String(id)),
    ),
  }
}
