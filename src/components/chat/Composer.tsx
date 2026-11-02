'use client'

import { useActionState, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Button, FormNote, Notice, focusRing } from '@/components/ui'
import { IconSend } from '@/components/Icons'
import { sendOpenerAction, sendTextAction, type ChatActionState } from '@/app/actions/chat'

const initial: ChatActionState = {}

/**
 * Where the reply is typed.
 *
 * Enter sends and Shift+Enter breaks a line, as in WhatsApp itself; a
 * telecaller moving between the phone and this box should not have to find
 * a button. The box is uncontrolled and remounted after a successful send,
 * which is how CallNoteForm clears itself too.
 *
 * When the 24-hour window is shut the box is replaced, not disabled: a grey
 * textarea says "broken", while a sentence and the one allowed action say
 * what to do instead.
 */
export function Composer({
  conversationId,
  windowOpen,
  windowReason,
  openerAvailable,
}: {
  conversationId: string
  windowOpen: boolean
  windowReason: 'never' | 'expired' | null
  openerAvailable: boolean
}) {
  if (!windowOpen) {
    return (
      <WindowClosed conversationId={conversationId} reason={windowReason ?? 'expired'} openerAvailable={openerAvailable} />
    )
  }
  return <TextComposer conversationId={conversationId} />
}

function TextComposer({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(sendTextAction, initial)
  const formRef = useRef<HTMLFormElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  // A soft keyboard has no Shift+Enter, so on a touch screen Enter has to
  // break a line and the button sends — as WhatsApp's own phone app does.
  // Known only in the browser; the server pass assumes a keyboard.
  const coarse = useCoarsePointer()

  // Back to the box after each send, and after a failure so the kept text
  // can be fixed, without popping a phone's keyboard on first open.
  useEffect(() => {
    if (state.savedAt || state.error || !coarse) boxRef.current?.focus()
  }, [state.savedAt, state.error, coarse])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (coarse) return
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!pending && e.currentTarget.value.trim()) formRef.current?.requestSubmit()
    }
  }

  // Grow with the text, up to about five lines, then scroll.
  function autosize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  return (
    <form ref={formRef} action={action} className="border-t border-line bg-surface px-3 pb-2 pt-2.5 sm:px-4">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex items-end gap-2">
        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          Message
        </label>
        {/* Remounted on each successful send so the box empties; on a failed
            send the key is unchanged and the text comes back as the default,
            so React's post-action reset restores it rather than clearing it. */}
        <textarea
          key={state.savedAt ?? 'new'}
          ref={boxRef}
          id={`composer-${conversationId}`}
          name="text"
          rows={1}
          maxLength={4096}
          defaultValue={state.error ? (state.text ?? '') : ''}
          placeholder="Type a message"
          enterKeyHint={coarse ? 'enter' : 'send'}
          onKeyDown={onKeyDown}
          onInput={(e) => autosize(e.currentTarget)}
          disabled={pending}
          className={
            'min-h-10 w-full resize-none rounded-3xl border border-transparent bg-sunken px-4 py-2.5 text-sm leading-5 text-ink outline-none ' +
            'placeholder:text-faint focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent disabled:opacity-60'
          }
        />
        <Button type="submit" size="icon" pending={pending} aria-label="Send">
          {pending ? null : <IconSend size={16} aria-hidden />}
        </Button>
      </div>
      <div className="mt-1.5 flex min-h-4 items-center justify-between gap-3 text-[11px] text-faint">
        <span className="hidden sm:inline">{coarse ? 'Tap the arrow to send' : 'Enter to send · Shift+Enter for a new line'}</span>
        <FormNote state={{ error: state.error }} className="text-xs" />
      </div>
    </form>
  )
}

const COARSE = '(pointer: coarse)'
function subscribeCoarse(onChange: () => void) {
  const mq = window.matchMedia(COARSE)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia(COARSE).matches,
    () => false,
  )
}

function WindowClosed({
  conversationId,
  reason,
  openerAvailable,
}: {
  conversationId: string
  reason: 'never' | 'expired'
  openerAvailable: boolean
}) {
  const [state, action, pending] = useActionState(sendOpenerAction, initial)
  return (
    <div className="border-t border-line bg-surface p-3 sm:px-4">
      <Notice tone="info" className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1 text-pretty">
          {reason === 'never'
            ? 'WhatsApp only lets a business write first with an approved template. Send it; once the passenger replies you can chat freely for 24 hours.'
            : 'More than 24 hours since the passenger last wrote, so WhatsApp allows only a template now. Send it; their reply reopens the chat.'}
        </span>
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <Button
            type="submit"
            size="sm"
            pending={pending}
            disabled={!openerAvailable}
            title={openerAvailable ? undefined : 'No opener template is configured yet. Ask an admin to set one up.'}
            className={focusRing}
          >
            Send opener template
          </Button>
        </form>
      </Notice>
      <div className="mt-1.5 min-h-4 text-xs">
        <FormNote state={state} className="text-xs" />
      </div>
    </div>
  )
}
