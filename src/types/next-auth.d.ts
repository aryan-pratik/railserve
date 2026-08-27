import type { Role } from '@/lib/roles'

declare module 'next-auth' {
  interface User {
    role: Role
    restaurantId: string | null
  }

  interface Session {
    user: {
      id: string
      name: string
      role: Role
      restaurantId: string | null
    }
  }
}

// The JWT interface is declared in @auth/core/jwt; next-auth/jwt only
// re-exports it, so augmenting the re-export has no effect.
declare module '@auth/core/jwt' {
  interface JWT {
    userId: string
    role: Role
    restaurantId: string | null
  }
}

export {}
