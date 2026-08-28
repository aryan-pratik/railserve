'use server'

import { signOut } from '@/auth'

export async function logout() {
  // Auth.js resolves `redirectTo` against the bare request origin, not
  // Next's `basePath` — see the matching note in login/actions.ts.
  await signOut({ redirectTo: `${process.env.BASE_PATH ?? ''}/login` })
}
