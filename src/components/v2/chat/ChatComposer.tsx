'use client'

import { useActionState, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import type { ChatActionState } from '@/app/actions/chat'
import { sendOpenerV2, sendTextV2 } from '@/app/v2/chat/actions'
import { FormLine } from '@/components/v2/CallsDialog'
import { Notice } from '@/components/v2/Table'
import { Button, cx, v2Focus } from '@/components/v2/ui'

const initial: ChatActionState = {}

/**
 * Where the reply is typed. Enter sends and Shift+Enter breaks a line on a
 * keyboard; on a touch screen Enter breaks a line and the button sends. The
 * box is uncontrolled and remounted after a successful send; on a failed
 * send the key is unchanged and the text comes back as the default.
 * When the 24-hour window is shut the box is replaced, not disabled.
 */
export function ChatComposer({
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
  if (!windowOpen) return <WindowClosed conversationId={conversationId} reason={windowReason ?? 'expired'} openerAvailable={openerAvailable} />
  return <TextComposer conversationId={conversationId} />
}

function TextComposer({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(sendTextV2, initial)
  const formRef = useRef<HTMLFormElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
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
    <form ref={formRef} action={action} className="border-t border-v2-line bg-v2-surface px-3 pb-2 pt-2.5 sm:px-4">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex items-end gap-2">
        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          Message
        </label>
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
          className={cx(
            'min-h-10 w-full resize-none rounded-[22px] border border-transparent bg-v2-surface-2 px-4 py-2.5 text-sm leading-5 text-v2-ink outline-none',
            'placeholder:text-v2-faint focus:border-v2-brand focus:bg-v2-surface focus:ring-2 focus:ring-v2-brand/30 disabled:opacity-60',
          )}
        />
        <button
          type="submit"
          disabled={pending}
          aria-label="Send"
          className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full bg-v2-brand text-white hover:bg-v2-brand-hover disabled:opacity-50', v2Focus)}
        >
          <SendHorizontal size={18} aria-hidden />
        </button>
      </div>
      <div className="mt-1.5 flex min-h-4 items-center justify-between gap-3 text-[11px] text-v2-faint">
        <span className="hidden sm:inline">{coarse ? 'Tap the arrow to send' : 'Enter to send · Shift+Enter for a new line'}</span>
        <FormLine state={{ error: state.error }} />
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

function WindowClosed({ conversationId, reason, openerAvailable }: { conversationId: string; reason: 'never' | 'expired'; openerAvailable: boolean }) {
  const [state, action, pending] = useActionState(sendOpenerV2, initial)
  return (
    <div className="border-t border-v2-line bg-v2-surface p-3 sm:px-4">
      <Notice tone="info" className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1">
          {reason === 'never'
            ? 'WhatsApp only lets a business write first with an approved template. Send it; once the passenger replies you can chat freely for 24 hours.'
            : 'More than 24 hours since the passenger last wrote, so WhatsApp allows only a template now. Send it; their reply reopens the chat.'}
        </span>
        {/* Under the text on a phone, beside it when there is room: never squeezing the sentence into a column. */}
        <form action={action} className="flex basis-full items-center gap-2 sm:basis-auto">
          <input type="hidden" name="conversationId" value={conversationId} />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending || !openerAvailable}
            title={openerAvailable ? undefined : 'No opener template is configured yet. Ask an admin to set one up.'}
          >
            {pending ? 'Sending…' : 'Send opener template'}
          </Button>
        </form>
      </Notice>
      <div className="mt-1.5 min-h-4">
        <FormLine state={state} />
      </div>
    </div>
  )
}
