import { env } from './env'

/*
 * The pieces of "Link Gmail" that are not Google calls: where Google sends
 * people back to, what is searched to check it is the right mailbox, and the
 * words shown when something goes wrong.
 */

export const GMAIL_LINK_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email']
export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/** This server's public address: APP_URL, else what the request (behind nginx) says. */
export function publicOrigin(request: Request): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, '')
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  return `${proto}://${host}`
}

export const callbackUrl = (request: Request) => `${publicOrigin(request)}/api/gmail/link/callback`

/** Where the link started, and so where it returns to. */
export type LinkFrom = 'onboarding' | 'settings'
export const backTo = (from: LinkFrom) => (from === 'onboarding' ? '/onboarding' : '/v2/settings?tab=mail')

/**
 * Order emails from the aggregators RailServe reads, for the "is this the
 * right Gmail?" check: their sending domains, and "PNR", which every
 * train-food order carries. Only counted, never read, at link time.
 */
export const ORDER_MAIL_QUERY =
  'newer_than:30d {from:yatribhojan.com from:yatrirestro.com from:rajbhogkhana.com from:zoopindia.com from:brotherbyte.com from:railrestro.com from:irctc.co.in subject:PNR "PNR"}'

export const LINK_ERRORS: Record<string, string> = {
  denied: 'You closed Google before allowing access, so nothing was linked. Press Link Gmail to try again.',
  scope: 'Google did not give permission to read emails. Press Link Gmail again, and tick the box to let RailServe read your emails.',
  expired: 'That took too long, or was started by someone else. Press Link Gmail again.',
  taken: 'This Gmail is already linked to another company on RailServe. Use the Gmail that receives your own orders.',
  token: 'Google did not finish linking. Press Link Gmail again; if it keeps happening, remove RailServe from your Google account’s third-party access and try once more.',
  notready: 'Gmail can be linked once all your documents are accepted.',
  setup: 'Linking Gmail is not set up on this server yet. Please contact RailServe.',
  failed: 'Something went wrong while linking. Please try again.',
}
