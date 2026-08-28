import type { Types } from 'mongoose'
import type { Role } from './roles'

/**
 * The authenticated caller. Every scoped data access takes one of these.
 *
 * restaurantIds is non-empty exactly when role === 'STORE_MANAGER'; it is the
 * set the repository filters on and the single thing standing between one
 * outlet and another outlet's orders. Empty for ADMIN (who is scoped by role,
 * not by outlet) and for DELIVERY_AGENT (scoped by assignment).
 */
export type AuthContext = {
  userId: Types.ObjectId
  role: Role
  restaurantIds: Types.ObjectId[]
}

/** True when the caller may act on an order belonging to this outlet. */
export function ownsOutlet(ctx: AuthContext, restaurantId: Types.ObjectId | string): boolean {
  if (ctx.role === 'ADMIN') return true
  return ctx.restaurantIds.some((id) => id.equals(restaurantId))
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message)
    this.name = 'ConflictError'
  }
}
