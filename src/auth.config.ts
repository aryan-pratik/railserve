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
        token.restaurantId = user.restaurantId
        token.name = user.name
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.userId
      session.user.role = token.role
      session.user.restaurantId = token.restaurantId
      session.user.name = token.name ?? ''
      return session
    },
  },
} satisfies NextAuthConfig
