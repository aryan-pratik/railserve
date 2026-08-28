import type { NextAuthConfig } from 'next-auth'
import { env } from './lib/env'

/**
 * DB-free half of the Auth.js config.
 *
 * Kept separate from auth.ts so proxy.ts can verify a session without pulling
 * Mongoose into its module graph — the proxy runs on every request, including
 * prefetches, and has no business opening a database connection.
 */
export const authConfig = {
  // Auth.js would find AUTH_SECRET in the environment on its own. Passing it
  // explicitly routes it through the validated env module instead, so a missing
  // or too-short secret fails at boot with a clear message rather than
  // producing sessions that silently fail to verify.
  secret: env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id!
        token.role = user.role
        token.restaurantIds = user.restaurantIds
        token.name = user.name
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.userId
      session.user.role = token.role
      // Default to none, not to everything. A token issued before outlets
      // became a list carries no restaurantIds, and a store manager holding an
      // old cookie must fail closed and re-authenticate — never fall through
      // to an unscoped read.
      session.user.restaurantIds = token.restaurantIds ?? []
      session.user.name = token.name ?? ''
      return session
    },
  },
} satisfies NextAuthConfig
