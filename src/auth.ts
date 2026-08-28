import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { authConfig } from './auth.config'
import { connectDb } from './lib/db'
import { User } from './lib/models'
import { env } from './lib/env'

const CredentialsSchema = z.object({
  phone: z.string().trim().min(1),
  password: z.string().min(1),
})

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  secret: env.AUTH_SECRET,
  providers: [
    Credentials({
      // Login is by phone. There is no email field anywhere in the data model.
      credentials: {
        phone: { label: 'Phone', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = CredentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        await connectDb()
        const user = await User.findOne({ phone: parsed.data.phone, active: true })
        if (!user) return null

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash)
        if (!ok) return null

        // Tolerate a record that predates the migration to multi-outlet rather
        // than throwing inside authorize, which Auth.js surfaces as an opaque
        // CallbackRouteError. Missing outlets is "no outlets" — and the guard
        // below then refuses the login, which is the correct outcome anyway.
        const restaurantIds = (user.restaurantIds ?? []).map(String)

        // A store manager with no outlet cannot be scoped to anything, so
        // letting them in would mean deciding at read time what they can see.
        // Refuse at the door instead.
        if (user.role === 'STORE_MANAGER' && restaurantIds.length === 0) return null

        return {
          id: String(user._id),
          name: user.name,
          role: user.role,
          restaurantIds,
        }
      },
    }),
  ],
})
