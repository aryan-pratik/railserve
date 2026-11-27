import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { loadUser } from '@/lib/tenancy/userContext'
import { gmailClientFor, gmailOAuth } from '@/lib/ingest/gmail/client'
import { verify } from '@/lib/crypto/secretBox'
import { MailboxError, linkMailbox } from '@/lib/repo/mailboxRepo'
import { activateIfReady } from '@/lib/repo/onboardingRepo'
import { GMAIL_READ_SCOPE, ORDER_MAIL_QUERY, backTo, callbackUrl, publicOrigin, type LinkFrom } from '@/lib/gmailLink'

export const dynamic = 'force-dynamic'

/**
 * Google sends the admin back here. The link is saved only if the signed
 * state is ours, unexpired, and was started by this same signed-in admin;
 * Google granted read access; and the Gmail is not another company's.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const state = verify<{ t: string; u: string; f: LinkFrom }>(params.get('state') ?? '')
  const from: LinkFrom = state?.f === 'onboarding' ? 'onboarding' : 'settings'
  const go = (q: string) => NextResponse.redirect(`${publicOrigin(request)}${backTo(from)}${backTo(from).includes('?') ? '&' : '?'}${q}`)

  if (params.get('error')) return go('gmail=error&reason=denied')
  const session = await auth()
  const user = session?.user?.id ? await loadUser(session.user.id) : null
  if (!state || !user || user.id !== state.u || user.tenantId !== state.t || user.role !== 'ADMIN') return go('gmail=error&reason=expired')
  const code = params.get('code')
  if (!code) return go('gmail=error&reason=denied')

  try {
    const { tokens } = await gmailOAuth(callbackUrl(request)).getToken(code)
    if (!tokens.refresh_token) return go('gmail=error&reason=token')
    if (!(tokens.scope ?? '').split(/\s+/).includes(GMAIL_READ_SCOPE)) return go('gmail=error&reason=scope')

    const gmail = gmailClientFor(tokens.refresh_token)
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const email = profile.data.emailAddress
    if (!email) return go('gmail=error&reason=token')
    // "Is this the right Gmail?": how many order emails it got lately.
    const found = await gmail.users.messages
      .list({ userId: 'me', q: ORDER_MAIL_QUERY, maxResults: 100 })
      .then((r) => r.data.messages?.length ?? 0)
      .catch(() => null)

    await linkMailbox({ tenantId: user.tenantId, userId: user.id, email, refreshToken: tokens.refresh_token, historyId: profile.data.historyId ?? null, found })
    if (user.onboarding) await activateIfReady(user.tenantId)
    return go('gmail=linked')
  } catch (err) {
    if (err instanceof MailboxError) return go('gmail=error&reason=taken')
    console.error('[gmail-link]', err instanceof Error ? err.message : err)
    return go('gmail=error&reason=failed')
  }
}
