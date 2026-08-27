import type { Types } from 'mongoose'
import type { Role } from './roles'

/**
 * The authenticated caller. Every scoped data access takes one of these.
 *
 * restaurantId is non-null exactly when role === 'STORE_MANAGER'; it is the
 * value the repository filters on and the single thing standing between one
 * outlet and another outlet's orders.
 */
export type AuthContext = {
  userId: Types.ObjectId
  role: Role
  restaurantId: Types.ObjectId | null
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
