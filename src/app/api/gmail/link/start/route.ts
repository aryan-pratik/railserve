import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { loadUser } from '@/lib/tenancy/userContext'
import { isGmailAppConfigured, gmailOAuth } from '@/lib/ingest/gmail/client'
import { sign } from '@/lib/crypto/secretBox'
import { applicationOf } from '@/lib/repo/onboardingRepo'
import { GMAIL_LINK_SCOPES, backTo, callbackUrl, publicOrigin, type LinkFrom } from '@/lib/gmailLink'

export const dynamic = 'force-dynamic'

/**
 * "Link Gmail": sends the company's admin to Google to pick the Gmail their
 * orders arrive in. Google is asked to show the account chooser every time,
 * so nobody links whichever Gmail the browser happens to be signed in to.
 */
export async function GET(request: Request) {
  const from: LinkFrom = new URL(request.url).searchParams.get('from') === 'onboarding' ? 'onboarding' : 'settings'
  const back = (reason: string) => NextResponse.redirect(`${publicOrigin(request)}${backTo(from)}${backTo(from).includes('?') ? '&' : '?'}gmail=error&reason=${reason}`)

  const session = await auth()
  const user = session?.user?.id ? await loadUser(session.user.id) : null
  if (!user || user.role !== 'ADMIN') return NextResponse.redirect(`${publicOrigin(request)}/login`)
  if (!isGmailAppConfigured()) return back('setup')
  if (user.onboarding) {
    const app = await applicationOf(user.tenantId)
    if (!app || app.progress.documents.state !== 'done') return back('notready')
  }

  const state = sign({ t: user.tenantId, u: user.id, f: from }, 15 * 60_000)
  const url = gmailOAuth(callbackUrl(request)).generateAuthUrl({
    access_type: 'offline',
    // Always ask: a fresh consent is what returns a refresh token, and the
    // chooser makes them pick the Gmail on purpose.
    prompt: 'consent select_account',
    scope: GMAIL_LINK_SCOPES,
    include_granted_scopes: false,
    state,
  })
  return NextResponse.redirect(url)
}
