import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { labelsFor, listConversations, type ConversationFilter } from '@/lib/repo/whatsappRepo'
import { RAIL_PAGE, toConversationRow } from '@/components/chat/chatView'

export const dynamic = 'force-dynamic'

/**
 * The next page of the conversation rail, for its infinite scroll. The
 * first page is server-rendered with the screen; this answers the second
 * and later ones as the reader nears the bottom, and refetches the lot when
 * the live feed says something moved.
 */
export async function GET(request: Request) {
  const ctx = await requireAuth()
  if (ctx.role !== 'TELECALLER' && ctx.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const u = new URL(request.url)
  const q = (u.searchParams.get('q') ?? '').trim()
  const f = u.searchParams.get('filter') ?? 'all'
  const filter: ConversationFilter =
    f === 'unread' || f === 'mine' || f === 'unassigned' ? f : 'all'
  const skip = Math.max(0, Number.parseInt(u.searchParams.get('skip') ?? '0', 10) || 0)
  const limit = Math.min(200, Math.max(1, Number.parseInt(u.searchParams.get('limit') ?? String(RAIL_PAGE), 10) || RAIL_PAGE))

  await connectDb()
  const { rows, total } = await listConversations(ctx, { q, filter, skip, limit })
  const labels = await labelsFor(rows)
  const me = String(ctx.userId)
  return NextResponse.json({
    rows: rows.map((c) => toConversationRow(c, labels, me)),
    total,
    hasMore: skip + rows.length < total,
  })
}
