'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { OnboardingError, signupCompany } from '@/lib/repo/onboardingRepo'

export type SignupState = { error?: string; values?: Record<string, string> }

/** Creates the company and its owner's account, signs them in, and opens the onboarding screen. */
export async function signup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const values = {
    businessName: String(formData.get('businessName') ?? ''),
    ownerName: String(formData.get('ownerName') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    email: String(formData.get('email') ?? ''),
  }
  const password = String(formData.get('password') ?? '')
  if (password !== String(formData.get('password2') ?? '')) return { error: 'The two passwords do not match.', values }
  try {
    await signupCompany({ ...values, password })
  } catch (err) {
    if (err instanceof OnboardingError) return { error: err.message, values }
    console.error('[signup]', err)
    return { error: 'Something went wrong. Please try again.', values }
  }
  try {
    await signIn('credentials', { phone: values.phone.replace(/\D/g, '').slice(-10), password, redirectTo: `${process.env.BASE_PATH ?? ''}/onboarding` })
  } catch (err) {
    // signIn signals its redirect by throwing; only a real auth failure lands here.
    if (err instanceof AuthError) return { error: 'Your account was created. Please sign in.', values }
    throw err
  }
  return {}
}
