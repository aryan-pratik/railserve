/**
 * WhatsApp's customer-service window.
 *
 * A business may send free text only inside 24 hours of the customer's last
 * message. Outside that, the only thing it may send is a pre-approved
 * template, which is what reopens the window once the customer answers. The
 * rule is Meta's, not MSG91's, and the provider rejects a free-text send
 * outside the window — so the screen says so before the telecaller types,
 * rather than after.
 */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000

export type SessionWindow =
  | { open: true; closesAt: Date }
  | { open: false; reason: 'never' | 'expired' }

export function sessionWindow(lastInboundAt: Date | string | null | undefined, now = new Date()): SessionWindow {
  if (!lastInboundAt) return { open: false, reason: 'never' }
  const at = new Date(lastInboundAt).getTime()
  const closesAt = at + SESSION_WINDOW_MS
  if (closesAt <= now.getTime()) return { open: false, reason: 'expired' }
  return { open: true, closesAt: new Date(closesAt) }
}

/** "23h 12m" / "40m" / "under a minute", for the window pill. */
export function formatRemaining(closesAt: Date, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((closesAt.getTime() - now.getTime()) / 60_000))
  if (minutes < 1) return 'under a minute'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
