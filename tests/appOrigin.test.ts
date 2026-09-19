import { describe, expect, it, vi } from 'vitest'

/**
 * The origin the print pipeline hands to headless Chrome.
 *
 * Puppeteer runs inside the app container and navigates to this URL to
 * screenshot the KOT page, so getting it wrong does not degrade gracefully —
 * it fails the print outright. In production the app sits behind nginx, and
 * the only header that carries the public hostname is x-forwarded-host; the
 * request's own `host` is whatever nginx dialled, which in Docker is the
 * container's id. A reprint route that read `req.url` instead of these
 * headers produced https://<container-id>:3000/... and every reprint died
 * with ERR_SSL_PROTOCOL_ERROR against a port that speaks plain HTTP.
 */

const headerMap = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => headerMap.get(k.toLowerCase()) ?? null }),
}))

// Kept out of the module graph: importing the real ones drags in puppeteer,
// sharp and a Mongo connection for a function that only reads headers.
vi.mock('@/lib/printer/screenshot', () => ({ renderKotScreenshots: vi.fn() }))
vi.mock('@/lib/db', () => ({ connectDb: vi.fn() }))
vi.mock('@/lib/models', () => ({ PrintJob: {} }))
vi.mock('@/lib/env', () => ({ env: { PRINT_RENDER_TOKEN: 'test-token' } }))

const { getAppOrigin } = await import('../src/lib/printer/queue')

function givenHeaders(h: Record<string, string>) {
  headerMap.clear()
  for (const [k, v] of Object.entries(h)) headerMap.set(k.toLowerCase(), v)
}

describe('getAppOrigin', () => {
  it('uses the public hostname nginx forwards, not the container it dialled', () => {
    // The exact shape of the production bug: both headers present, and the
    // request's own host is the Docker container id.
    givenHeaders({
      'x-forwarded-host': 'bitestation.elvo.in',
      'x-forwarded-proto': 'https',
      host: 'e32481cc87cf:3000',
    })
    return expect(getAppOrigin()).resolves.toBe('https://bitestation.elvo.in')
  })

  it('falls back to host when there is no proxy in front', () => {
    givenHeaders({ host: 'localhost:3000' })
    return expect(getAppOrigin()).resolves.toBe('http://localhost:3000')
  })

  it('assumes https for a non-localhost host with no forwarded proto', () => {
    givenHeaders({ host: 'bitestation.elvo.in' })
    return expect(getAppOrigin()).resolves.toBe('https://bitestation.elvo.in')
  })

  it('honours a forwarded proto of http', () => {
    givenHeaders({ 'x-forwarded-host': 'box.local', 'x-forwarded-proto': 'http' })
    return expect(getAppOrigin()).resolves.toBe('http://box.local')
  })

  it('builds an origin the print page path can be resolved against', async () => {
    givenHeaders({ 'x-forwarded-host': 'bitestation.elvo.in', 'x-forwarded-proto': 'https' })
    const origin = await getAppOrigin()
    expect(new URL('/internal/print/run/12566~2026-09-19~CNB', origin).toString()).toBe(
      'https://bitestation.elvo.in/internal/print/run/12566~2026-09-19~CNB',
    )
  })
})
