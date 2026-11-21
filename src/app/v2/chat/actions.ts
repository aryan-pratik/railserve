'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { openConversationForOrder, openConversationForPhone } from '@/lib/repo/whatsappRepo'
import {
  assignToAction,
  markReadAction,
  releaseConversationAction,
  sendOpenerAction,
  sendTextAction,
  takeConversationAction,
  type ChatActionState,
} from '@/app/actions/chat'

/*
 * Thin v2 wrappers around the chat actions. The v1 actions hold every rule
 * and revalidate the v1 consoles; these add the v2 tree (the layout carries
 * the unread badge, so the whole segment) and, for the two that redirect,
 * land on /v2/chat instead of a v1 console.
 */

function revalidateV2() {
  revalidatePath('/v2', 'layout')
}

type Prev = ChatActionState

export async function sendTextV2(prev: Prev, formData: FormData): Promise<ChatActionState> {
  const result = await sendTextAction(prev, formData)
  revalidateV2()
  return result
}

export async function sendOpenerV2(prev: Prev, formData: FormData): Promise<ChatActionState> {
  const result = await sendOpenerAction(prev, formData)
  revalidateV2()
  return result
}

export async function takeConversationV2(prev: Prev, formData: FormData): Promise<ChatActionState> {
  const result = await takeConversationAction(prev, formData)
  revalidateV2()
  return result
}

export async function releaseConversationV2(prev: Prev, formData: FormData): Promise<ChatActionState> {
  const result = await releaseConversationAction(prev, formData)
  revalidateV2()
  return result
}

export async function assignToV2(prev: Prev, formData: FormData): Promise<ChatActionState> {
  const result = await assignToAction(prev, formData)
  revalidateV2()
  return result
}

export async function markReadV2(conversationId: string): Promise<void> {
  await markReadAction(conversationId)
  revalidateV2()
}

/** "New chat" with a typed number: opens or finds the thread and goes there. */
export async function startChatV2(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const phone = String(formData.get('phone') ?? '')
  const name = String(formData.get('name') ?? '').trim() || null
  await connectDb()
  let id: string
  try {
    id = await openConversationForPhone(ctx, phone, name)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not start the chat.' }
  }
  revalidateV2()
  redirect(`/v2/chat/${id}`)
}

/** "WhatsApp" from an order: for the order workspace to call. redirect() throws, so it sits outside the try. */
export async function openChatForOrderV2(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  await connectDb()
  let id: string
  try {
    id = await openConversationForOrder(ctx, orderId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not open the chat.' }
  }
  revalidateV2()
  redirect(`/v2/chat/${id}`)
}
