import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from './auth.config'
import { ROLE_HOME, ROLE_PREFIX, type Role } from './lib/roles'

/**
 * Next 16 renamed Middleware to Proxy. Same mechanics, `nodejs` runtime.
 *
 * This performs OPTIMISTIC checks only — it reads the signed session cookie and
 * redirects. It is deliberately not the authorization boundary: the Next.js
 * docs are explicit that a proxy runs on prefetches too, and route segments
 * render regardless of what a layout decides. Real enforcement lives in the
 * scoped repository, where the data actually is.
 */
const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const { pathname } = req.nextUrl
  const role = req.auth?.user?.role as Role | undefined

  const isAuthRoute = pathname === '/login'
  const isProtected = Object.values(ROLE_PREFIX).some((p) => pathname.startsWith(p))

  if (!role) {
    if (isProtected) {
      const url = new URL('/login', req.nextUrl)
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // Signed in and sitting on the login page — send them where they belong.
  if (isAuthRoute) {
    return NextResponse.redirect(new URL(ROLE_HOME[role], req.nextUrl))
  }

  // Signed in but wandering into another role's section.
  const ownPrefix = ROLE_PREFIX[role]
  if (isProtected && !pathname.startsWith(ownPrefix)) {
    return NextResponse.redirect(new URL(ROLE_HOME[role], req.nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
