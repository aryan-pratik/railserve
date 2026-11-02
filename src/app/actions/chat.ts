'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import type { AuthContext } from '@/lib/authContext'
import {
  assignConversation,
  markRead,
  openConversationForOrder,
  openConversationForPhone,
  sendOpenerTemplate,
  sendText,
  WA_TEXT_MAX,
} from '@/lib/repo/whatsappRepo'
import { getWhatsAppProvider, openerTemplate } from '@/lib/whatsapp'
import { CHAT_BASE_PATHS, type ChatBasePath } from '@/lib/whatsapp/consoles'

export type ChatActionState = {
  error?: string
  ok?: string
  /** Changes on every success, so a caller can tell one send from the next. */
  savedAt?: string
  /** On a failed send: what was typed, so the box can keep it instead of resetting. */
  text?: string
}

/**
 * A form says which console it sits on so a redirect lands back where the
 * person was; anything else falls back to the caller's own console rather
 * than trusting the field.
 */
function basePathFor(ctx: AuthContext, formData: FormData): ChatBasePath {
  const asked = String(formData.get('basePath') ?? '')
  if ((CHAT_BASE_PATHS as readonly string[]).includes(asked)) return asked as ChatBasePath
  return ctx.role === 'ADMIN' ? '/admin/chat' : '/calls/chat'
}

/**
 * Every screen a thread is drawn on, in both consoles. The `layout` scope
 * takes each nav badge with it, which is why it is whole sections and not
 * one path each.
 */
function revalidateChat() {
  revalidatePath('/calls', 'layout')
  revalidatePath('/admin', 'layout')
}

/** A free-text reply, typed in the composer. */
export async function sendTextAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const conversationId = String(formData.get('conversationId') ?? '')
  const text = String(formData.get('text') ?? '').trim()

  if (!text) return { error: 'Write something to send.' }
  if (text.length > WA_TEXT_MAX) return { error: `Keep a message under ${WA_TEXT_MAX} characters.` }

  await connectDb()
  try {
    await sendText(ctx, conversationId, text, getWhatsAppProvider())
  } catch (err) {
    // The failed line is already in the thread, marked as such; the form
    // just has to say why so the telecaller knows not to retype it blind.
    revalidateChat()
    return { error: err instanceof Error ? err.message : 'Could not send the message.', text }
  }
  revalidateChat()
  return { ok: 'Sent.', savedAt: new Date().toISOString() }
}

/** The approved opener template, for a passenger outside the 24-hour window. */
export async function sendOpenerAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const conversationId = String(formData.get('conversationId') ?? '')
  const template = openerTemplate()
  if (!template) return { error: 'No opener template is configured yet. Ask an admin to set one up.' }

  await connectDb()
  try {
    await sendOpenerTemplate(ctx, conversationId, getWhatsAppProvider(), template)
  } catch (err) {
    revalidateChat()
    return { error: err instanceof Error ? err.message : 'Could not send the template.' }
  }
  revalidateChat()
  return { ok: 'Template sent. Free-text replies open once the passenger answers.', savedAt: new Date().toISOString() }
}

export async function takeConversationAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const conversationId = String(formData.get('conversationId') ?? '')
  await connectDb()
  try {
    await assignConversation(ctx, conversationId, String(ctx.userId))
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not take the conversation.' }
  }
  revalidateChat()
  return { ok: 'Taken.', savedAt: new Date().toISOString() }
}

export async function releaseConversationAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const conversationId = String(formData.get('conversationId') ?? '')
  await connectDb()
  try {
    await assignConversation(ctx, conversationId, null)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not release the conversation.' }
  }
  revalidateChat()
  return { ok: 'Released.', savedAt: new Date().toISOString() }
}

/**
 * An admin handing a thread to a named person, or to nobody. The repository
 * refuses this for a telecaller, so the admin check is there, not here.
 */
export async function assignToAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('ADMIN')
  const conversationId = String(formData.get('conversationId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  await connectDb()
  try {
    await assignConversation(ctx, conversationId, userId || null)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reassign the conversation.' }
  }
  revalidateChat()
  return { ok: userId ? 'Reassigned.' : 'Unassigned.', savedAt: new Date().toISOString() }
}

/** Called once by the thread screen when it opens with unread messages. */
export async function markReadAction(conversationId: string): Promise<void> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  await connectDb()
  try {
    await markRead(ctx, conversationId)
  } catch {
    // Out of scope or gone: nothing to mark, nothing to say.
    return
  }
  revalidateChat()
}

/**
 * "WhatsApp" from an order: opens (or finds) the passenger's thread and goes
 * there, on whichever console the button was pressed. A refusal (no dialable
 * number, a thread another outlet holds) comes back as the form's error.
 * redirect() throws, so it sits outside the try.
 */
export async function openChatForOrderAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  await connectDb()
  let id: string
  try {
    id = await openConversationForOrder(ctx, orderId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not open the chat.' }
  }
  revalidateChat()
  redirect(`${basePathFor(ctx, formData)}/${id}`)
}

/** "New chat" with a number the telecaller or admin types in. */
export async function startChatAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
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
  revalidateChat()
  redirect(`${basePathFor(ctx, formData)}/${id}`)
}
