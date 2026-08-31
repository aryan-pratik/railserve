import http from 'node:http'
import { google } from 'googleapis'

/**
 * One-time interactive OAuth setup for Gmail ingestion. Referenced by
 * `npm run doctor` as the fix for a missing/half-configured Gmail transport.
 *
 * Google Cloud OAuth client credentials (a Client ID and Secret) cannot be
 * created programmatically — they require a human in the Google Cloud Console.
 * Everything after that this script automates: it opens the consent flow,
 * catches the redirect on a local server, and exchanges the code for a
 * refresh token, which is the only value that has to reach production (the
 * client ID/secret and refresh token together are what `client.ts` needs —
 * see GMAIL_* in .env.example).
 */

const PORT = 53_682
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

async function main() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.log(`
Gmail OAuth setup
=================

Before this script can run, create an OAuth client in Google Cloud Console
for the Google account that RECEIVES the order emails (not a service account):

  1. https://console.cloud.google.com/apis/credentials
     (create a project first if you don't have one)
  2. Enable the Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
  3. Configure the OAuth consent screen if prompted (External is fine; you
     don't need to publish it — just add the Gmail account as a test user).
  4. Create Credentials → OAuth client ID → Application type: "Web application".
     Under "Authorized redirect URIs" add exactly:
       ${REDIRECT_URI}
  5. Copy the generated Client ID and Client Secret into .env.local:
       GMAIL_CLIENT_ID=...
       GMAIL_CLIENT_SECRET=...

Then re-run: npm run gmail:setup
`)
    process.exit(1)
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    // Forces Google to reissue a refresh token even if this account already
    // granted consent before — without it a repeat run silently gets none.
    prompt: 'consent',
    scope: SCOPES,
  })

  console.log(`
Opening this in your browser (or paste it there manually) — sign in as the
Gmail account that receives order emails:

${authUrl}
`)

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const gotCode = url.searchParams.get('code')

      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(err ? `Failed: ${err}. You can close this tab.` : 'Success — you can close this tab.')
      server.close()

      if (err) reject(new Error(err))
      else if (gotCode) resolve(gotCode)
      else reject(new Error('no code in callback'))
    })
    server.listen(PORT)
  })

  const { tokens } = await oauth2Client.getToken(code)
  if (!tokens.refresh_token) {
    fail(
      'Google did not return a refresh token. This usually means the account already ' +
        'authorized this client without offline access — remove it at ' +
        'https://myaccount.google.com/permissions and run this script again.',
    )
  }

  console.log(`
✓ Done. Add this to .env.local (and to your production env vars):

GMAIL_REFRESH_TOKEN=${tokens.refresh_token}

GMAIL_TOPIC_NAME and GMAIL_USER_ID still need to be set separately if you
haven't already (see .env.example). Once all of GMAIL_CLIENT_ID/SECRET/
REFRESH_TOKEN/TOPIC_NAME are set, run "npm run doctor" to confirm.
`)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
