import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { labelsFor, listMessagesPage } from '@/lib/repo/whatsappRepo'
import { NotFoundError } from '@/lib/authContext'
import { toMessageView } from '@/components/chat/chatView'

export const dynamic = 'force-dynamic'

/**
 * Older messages of one thread, for the scroll-up-for-history gesture. The
 * newest page is server-rendered with the thread; this answers the pages
 * above it, oldest-first, each ending just before `before`.
 */
export async function GET(request: Request) {
  const ctx = await requireAuth()
  if (ctx.role !== 'TELECALLER' && ctx.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const u = new URL(request.url)
  const c = u.searchParams.get('c') ?? ''
  const beforeRaw = u.searchParams.get('before')
  const before = beforeRaw ? new Date(beforeRaw) : null
  if (before && Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: 'Bad cursor' }, { status: 400 })
  }

  await connectDb()
  try {
    const { rows, hasMore } = await listMessagesPage(ctx, c, { before })
    const labels = await labelsFor([], rows.map((m) => m.sentBy))
    const me = String(ctx.userId)
    return NextResponse.json({
      messages: rows.map((m) => toMessageView(m, (uid) => (uid === me ? 'You' : (labels.userName.get(uid) ?? null)))),
      hasMore,
    })
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw err
  }
}
