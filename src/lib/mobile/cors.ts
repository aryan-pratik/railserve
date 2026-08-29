import { NextResponse } from 'next/server'
import { env } from '../env'

/**
 * CORS for the mobile API.
 *
 * A native Expo build does not need any of this — there is no origin and no
 * preflight. It is needed the moment the same app runs in a browser, which is
 * how the rider app gets tested without a device: Expo web serves from :8081
 * and calls this API on :3000, and the browser blocks that as cross-origin.
 *
 * Deliberately an allow-list rather than `*`. These routes carry a bearer
 * token, so a wildcard would let any page on the internet make authenticated
 * calls on a rider's behalf if it ever got hold of one. In production the list
 * is empty unless MOBILE_CORS_ORIGINS says otherwise, so the browser path is
 * simply closed.
 */
function allowedOrigins(): string[] {
  const configured = env.MOBILE_CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (configured.length > 0) return configured

  // Expo web's dev server, and the LAN/Tailscale address it may be reached on.
  return env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:8081', 'http://127.0.0.1:8081']
}

function originHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!origin) return {}

  const allowed = allowedOrigins()
  // In development any localhost/LAN/Tailscale origin on the Expo port is
  // fine; pinning the exact host would break the moment the IP changes.
  const ok =
    allowed.includes(origin) ||
    (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin))
  if (!ok) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

/** Attach CORS headers to a response built by a route handler. */
export function withCors(request: Request, response: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(originHeaders(request))) {
    response.headers.set(k, v)
  }
  return response
}

/**
 * Preflight handler. Every mobile route exports this as OPTIONS — without one,
 * Next answers a preflight with 405 and the real request never happens.
 */
export function preflight(request: Request): NextResponse {
  const headers = originHeaders(request)
  if (Object.keys(headers).length === 0) {
    return new NextResponse(null, { status: 403 })
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}
