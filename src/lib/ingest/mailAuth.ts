/**
 * Whether Gmail could confirm a mail really came from the domain in its From
 * line. Anyone can type "orders@zoop.in" into a From header; only Zoop's own
 * mail servers can sign for zoop.in (DKIM) or pass its published policy
 * (DMARC). Gmail checks both on arrival and writes the result into an
 * Authentication-Results header of its own.
 *
 * Only Gmail's header is read: the one whose first word is mx.google.com. A
 * sender can include a copy of that header in its own mail, so any other is
 * ignored. Pure, so the tests and the settings screen share it.
 */

export type MailAuth = {
  /** DMARC passed, or a DKIM signature passed for the From domain. */
  verified: boolean
  dmarc: string | null
  spf: string | null
  /** Domains with a passing DKIM signature. */
  signedBy: string[]
}

/** Gmail's own Authentication-Results header, out of all of a message's headers. */
export function gmailAuthHeader(headers: { name?: string | null; value?: string | null }[] | undefined): string | null {
  for (const h of headers ?? []) {
    if (h.name?.toLowerCase() !== 'authentication-results') continue
    if (/^\s*mx\.google\.com\s*;/i.test(h.value ?? '')) return h.value ?? null
  }
  return null
}

const aligned = (a: string, b: string) => a === b || a.endsWith('.' + b) || b.endsWith('.' + a)

export function readMailAuth(header: string | null | undefined, fromAddress: string | null): MailAuth | null {
  if (!header) return null
  const h = header.slice(0, 4000)
  const dmarc = /\bdmarc=(\w+)/i.exec(h)?.[1]?.toLowerCase() ?? null
  const spf = /\bspf=(\w+)/i.exec(h)?.[1]?.toLowerCase() ?? null
  const signedBy: string[] = []
  for (const m of h.matchAll(/\bdkim=pass\b[^;]*?\bheader\.(?:i|d)=@?([a-z0-9.-]+)/gi)) {
    const d = m[1].toLowerCase()
    if (!signedBy.includes(d)) signedBy.push(d)
  }
  const fromDomain = fromAddress?.split('@')[1]?.toLowerCase() ?? null
  const verified = dmarc === 'pass' || (fromDomain !== null && signedBy.some((d) => aligned(d, fromDomain)))
  return { verified, dmarc, spf, signedBy }
}
