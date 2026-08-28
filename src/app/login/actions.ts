'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/auth'

export type LoginState = { error?: string }

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const phone = String(formData.get('phone') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!phone || !password) {
    return { error: 'Enter both phone number and password.' }
  }

  try {
    // Land on "/", which redirects by role — the role is not known until the
    // credentials have actually been checked. Auth.js resolves `redirectTo`
    // against the bare request origin, not Next's `basePath`, so under a
    // path-prefixed deployment (see next.config.ts) it must be spelled out
    // here or the redirect drops the prefix and escapes the app.
    await signIn('credentials', { phone, password, redirectTo: `${process.env.BASE_PATH ?? ''}/` })
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: 'Incorrect phone number or password.' }
    }
    // signIn signals a successful redirect by throwing; never swallow that.
    throw err
  }

  return {}
}
