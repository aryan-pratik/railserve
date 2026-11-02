import type { WaConversationDoc, WaMessageDoc } from '@/lib/models'
import { formatPhone } from '@/lib/whatsapp/phone'

/**
 * The chat as it crosses to the client: strings only, no ObjectIds, no
 * Dates. Same reasoning as callNotes.ts — a Date through the server/client
 * boundary is a silent mismatch waiting to happen.
 */

export type MessageView = {
  id: string
  direction: 'IN' | 'OUT'
  kind: 'TEXT' | 'TEMPLATE' | 'MEDIA' | 'OTHER'
  text: string | null
  mediaUrl: string | null
  mediaCaption: string | null
  templateName: string | null
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED'
  failReason: string | null
  /** ISO. */
  at: string
  /** Who sent it, for outbound lines written by someone else. */
  sender: string | null
}

export function toMessageView(m: WaMessageDoc, senderName: (id: string) => string | null): MessageView {
  return {
    id: String(m._id),
    direction: m.direction,
    kind: m.kind,
    text: m.text ?? null,
    mediaUrl: m.mediaUrl ?? null,
    mediaCaption: m.mediaCaption ?? null,
    templateName: m.templateName ?? null,
    status: m.status,
    failReason: m.failReason ?? null,
    at: new Date(m.createdAt).toISOString(),
    sender: m.sentBy ? senderName(String(m.sentBy)) : null,
  }
}

/** Threads per fetch on the rail: a phone screen's worth and a half. */
export const RAIL_PAGE = 30

/** One line of the conversation rail, serialised for the client. */
export type ConversationRowView = {
  id: string
  name: string
  phone: string
  preview: string | null
  previewDirection: 'IN' | 'OUT' | null
  /** ISO: the last message, or when the thread was opened. */
  at: string
  unread: number
  outlet: string | null
  /** 'You', a colleague's name, or null when nobody holds it. */
  assignee: string | null
}

export function toConversationRow(
  c: WaConversationDoc,
  labels: { outletName: Map<string, string>; userName: Map<string, string> },
  me: string,
): ConversationRowView {
  const at = c.lastMessageAt ?? c.createdAt
  return {
    id: String(c._id),
    name: displayName(c),
    phone: formatPhone(c.phone),
    preview: c.lastMessageText ?? null,
    previewDirection: c.lastMessageDirection ?? null,
    at: new Date(at).toISOString(),
    unread: c.unreadCount,
    outlet: c.restaurantId ? (labels.outletName.get(String(c.restaurantId)) ?? null) : null,
    assignee: c.assignedTo
      ? String(c.assignedTo) === me
        ? 'You'
        : (labels.userName.get(String(c.assignedTo)) ?? null)
      : null,
  }
}

/** The passenger's display name: what they or the order called them, else the number. */
export function displayName(c: Pick<WaConversationDoc, 'customerName' | 'phone'>): string {
  return c.customerName?.trim() || formatPhone(c.phone)
}

/** Two letters for the avatar circle. A bare number gets its last two digits. */
export function initialsOf(name: string): string {
  const words = name.replace(/^\+/, '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (/^\d/.test(words[0])) return name.slice(-2)
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
