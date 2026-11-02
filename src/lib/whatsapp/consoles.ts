/**
 * The two consoles that carry the chat. Lives outside the server-actions
 * module because a 'use server' file may export nothing but async functions.
 */
export const CHAT_BASE_PATHS = ['/calls/chat', '/admin/chat'] as const
export type ChatBasePath = (typeof CHAT_BASE_PATHS)[number]
