import type { Role } from '@/lib/roles'

declare module 'next-auth' {
  interface User {
    role: Role
    restaurantIds: string[]
  }

  interface Session {
    user: {
      id: string
      name: string
      role: Role
      restaurantIds: string[]
    }
  }
}

// The JWT interface is declared in @auth/core/jwt; next-auth/jwt only
// re-exports it, so augmenting the re-export has no effect.
declare module '@auth/core/jwt' {
  interface JWT {
    userId: string
    role: Role
    restaurantIds: string[]
  }
}

export {}
