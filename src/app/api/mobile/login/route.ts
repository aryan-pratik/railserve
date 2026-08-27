import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { issueMobileToken } from '@/lib/mobile/token'

export const dynamic = 'force-dynamic'

const Body = z.object({ phone: z.string().trim().min(1), password: z.string().min(1) })

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Phone and password are required.' }, { status: 400 })
  }

  await connectDb()
  const user = await User.findOne({ phone: parsed.data.phone, active: true })

  // Same message either way — distinguishing "no such user" from "wrong
  // password" tells an attacker which phone numbers are staff.
  const invalid = NextResponse.json(
    { error: 'Incorrect phone number or password.' },
    { status: 401 },
  )
  if (!user) return invalid
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return invalid

  // The app is for delivery agents. Letting other roles in would mean shipping
  // screens that do not exist.
  if (user.role !== 'DELIVERY_AGENT') {
    return NextResponse.json(
      { error: 'This app is for delivery agents. Use the web console for other roles.' },
      { status: 403 },
    )
  }

  const { token, expiresAt } = issueMobileToken(user)
  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    user: { id: String(user._id), name: user.name, phone: user.phone },
  })
}
