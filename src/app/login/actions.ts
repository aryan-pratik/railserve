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
    // credentials have actually been checked.
    await signIn('credentials', { phone, password, redirectTo: '/' })
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: 'Incorrect phone number or password.' }
    }
    // signIn signals a successful redirect by throwing; never swallow that.
    throw err
  }

  return {}
}
