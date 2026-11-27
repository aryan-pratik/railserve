import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { loadUser } from '@/lib/tenancy/userContext'
import { OnboardingError, uploadDocument } from '@/lib/repo/onboardingRepo'

export const dynamic = 'force-dynamic'

/**
 * An applicant uploads one document. A route rather than a server action:
 * server actions cap a request at 1 MB, and a phone photo of a licence is
 * often more. Only the owner of a company that is still joining may upload.
 */
export async function POST(request: Request) {
  const session = await auth()
  const user = session?.user?.id ? await loadUser(session.user.id) : null
  if (!user?.onboarding) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const kind = String(form?.get('kind') ?? '')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file first.' }, { status: 400 })
  try {
    await uploadDocument({ tenantId: user.tenantId, userId: user.id, kind, fileName: file.name, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof OnboardingError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[onboarding-upload]', err)
    return NextResponse.json({ error: 'Could not save that file. Please try again.' }, { status: 500 })
  }
}
