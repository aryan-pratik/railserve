import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { loadUser } from '@/lib/tenancy/userContext'
import { readTenantFile } from '@/lib/repo/onboardingRepo'

export const dynamic = 'force-dynamic'

/**
 * One uploaded document, shown in the browser. Personal data, so only to the
 * company's own admin and to a platform admin, never cached, never public.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tenantId = new URL(request.url).searchParams.get('tenant') ?? ''
  const session = await auth()
  const user = session?.user?.id ? await loadUser(session.user.id) : null
  const allowed = user && (user.platformAdmin || (user.tenantId === tenantId && user.role === 'ADMIN'))
  if (!allowed) return new NextResponse('Not found', { status: 404 })

  const file = await readTenantFile({ fileId: id, tenantId })
  if (!file) return new NextResponse('Not found', { status: 404 })
  const data = file.data as unknown as { buffer: ArrayBuffer } | Buffer
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from((data as { buffer: ArrayBuffer }).buffer)
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.fileName)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Shown inside RailServe's own preview window, and nowhere else.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  })
}
