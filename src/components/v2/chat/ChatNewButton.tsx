'use client'

import { useActionState, useCallback, useState } from 'react'
import { Plus } from 'lucide-react'
import type { ChatActionState } from '@/app/actions/chat'
import { startChatV2 } from '@/app/v2/chat/actions'
import { CallsDialog, FormLine, v2Input } from '@/components/v2/CallsDialog'
import { Button } from '@/components/v2/ui'

const initial: ChatActionState = {}

/** A thread with a number nobody has an order for yet. The usual way in is the WhatsApp button on an order. */
export function ChatNewButton() {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(startChatV2, initial)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)} title="Start a new chat">
        <Plus size={14} aria-hidden />
        New
      </Button>
      {open ? (
        <CallsDialog title="Start a WhatsApp chat" titleId="new-chat-dialog" onClose={close} className="max-w-sm">
          <form action={action} className="grid gap-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-semibold">Phone</span>
              <input name="phone" type="tel" inputMode="tel" autoComplete="off" required placeholder="98765 43210" className={`${v2Input} font-mono tabular-nums`} />
              <span className="text-xs text-v2-muted">10 digits, with or without +91.</span>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-semibold">Name</span>
              <input name="name" type="text" autoComplete="off" className={v2Input} />
              <span className="text-xs text-v2-muted">Optional. Shown on the list until an order fills it in.</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? 'Opening…' : 'Open chat'}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <FormLine state={state} />
            </div>
          </form>
        </CallsDialog>
      ) : null}
    </>
  )
}
