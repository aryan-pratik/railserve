'use client'

import { useActionState } from 'react'
import { Button, FormNote, focusRing } from '@/components/ui'
import { IconChat } from '@/components/Icons'
import { openChatForOrderAction, type ChatActionState } from '@/app/actions/chat'

const initial: ChatActionState = {}

/**
 * "WhatsApp" on an order page. A client form rather than a bare server
 * action so a refusal — a number that cannot be dialled, a thread another
 * outlet already holds — comes back as a sentence beside the button instead
 * of the console's error page.
 */
export function OpenChatButton({
  orderId,
  basePath,
  variant = 'button',
}: {
  orderId: string
  basePath: '/calls/chat' | '/admin/chat'
  /** The telecaller page has room for a labelled button; the admin's Contact row does not. */
  variant?: 'button' | 'icon'
}) {
  const [state, action, pending] = useActionState(openChatForOrderAction, initial)
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="basePath" value={basePath} />
      {variant === 'icon' ? (
        <button
          type="submit"
          disabled={pending}
          title="Message on WhatsApp"
          aria-label="Message on WhatsApp"
          className={`inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sunken hover:text-accent disabled:opacity-50 ${focusRing}`}
        >
          <IconChat size={16} aria-hidden />
        </button>
      ) : (
        <Button type="submit" variant="secondary" pending={pending}>
          <IconChat size={15} aria-hidden />
          WhatsApp
        </Button>
      )}
      <FormNote state={state} className="text-xs" />
    </form>
  )
}
