'use client'

import { useActionState, useCallback, useState } from 'react'
import { Button, Field, FormNote, inputClass } from '@/components/ui'
import { Modal } from '@/components/Modal'
import { IconPlus } from '@/components/Icons'
import { startChatAction, type ChatActionState } from '@/app/actions/chat'

const initial: ChatActionState = {}

/**
 * A thread with a number nobody has an order for yet — a passenger who rang
 * and asked to be sent the menu, say. The usual way in is the WhatsApp
 * button on an order, which already knows the number; this is the other way.
 */
export function NewChatButton({ basePath }: { basePath: string }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(startChatAction, initial)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <IconPlus size={14} aria-hidden />
        New
      </Button>

      {open ? (
        <Modal title="Start a WhatsApp chat" titleId="new-chat-modal" onClose={close} maxWidthClassName="max-w-sm">
          <form action={action} className="space-y-4 p-4">
            <input type="hidden" name="basePath" value={basePath} />
            <Field label="Phone" htmlFor="new-chat-phone" hint="10 digits, with or without +91.">
              <input
                id="new-chat-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                required
                autoFocus
                placeholder="98765 43210"
                className={`${inputClass} font-mono tabular-nums`}
              />
            </Field>
            <Field label="Name" htmlFor="new-chat-name" hint="Optional. Shown on the list until the order fills it in.">
              <input id="new-chat-name" name="name" type="text" autoComplete="off" className={inputClass} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" pending={pending}>
                Open chat
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <FormNote state={state} />
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}
