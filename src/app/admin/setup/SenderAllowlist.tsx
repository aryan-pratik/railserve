'use client'

import { useActionState, useRef, useEffect } from 'react'
import { Button, Card, CardHeader, FormNote, focusRing, inputBase } from '@/components/ui'
import { addAllowedSender, removeAllowedSender, type SenderState } from './senderActions'

/**
 * The aggregator mail senders whose email becomes orders.
 *
 * Empty means every sender, which is how ingestion worked before this list
 * existed — the copy says so, because an empty list reading as "nothing is
 * allowed" would be the natural, and wrong, assumption.
 */
export function SenderAllowlist({ senders }: { senders: string[] }) {
  const [state, formAction, pending] = useActionState<SenderState, FormData>(addAllowedSender, {})
  const inputRef = useRef<HTMLInputElement>(null)

  // Clear the box after a successful add, so the next address starts fresh.
  useEffect(() => {
    if (state.ok && inputRef.current) inputRef.current.value = ''
  }, [state])

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Order mail senders
            <span className="text-muted">
              {senders.length === 0 ? 'all senders parsed' : `${senders.length} listed`}
            </span>
          </span>
        }
      />
      <div className="space-y-3 px-3 py-3">
        <p className="text-sm text-muted">
          {senders.length === 0
            ? 'Every email in the mailbox is parsed today, so anything that is not an order lands in the Inbox. Add the addresses aggregators send orders from, and only their mail will be parsed. Mail from anyone else is skipped; an order from a listed sender that fails to parse still goes to the Inbox.'
            : 'Only mail from these senders is parsed into orders. Mail from anyone else is skipped and does not reach the Inbox. Bank payment alerts are always read, whatever this list says.'}
        </p>

        {senders.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {senders.map((s) => (
              <li
                key={s}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 font-mono text-xs text-slate-800 ring-1 ring-inset ring-slate-200"
              >
                {s}
                <form action={removeAllowedSender}>
                  <input type="hidden" name="sender" value={s} />
                  <button
                    type="submit"
                    aria-label={`Remove ${s}`}
                    title="Remove"
                    className={`rounded-full px-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 ${focusRing}`}
                  >
                    ×
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}

        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <label htmlFor="allowed-sender" className="sr-only">
            Sender email address
          </label>
          <input
            ref={inputRef}
            id="allowed-sender"
            name="sender"
            type="text"
            inputMode="email"
            autoComplete="off"
            placeholder="orders@zoop.in or @zoop.in"
            className={`${inputBase} h-9 min-w-[16rem] flex-1 text-sm sm:flex-none`}
          />
          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            Add sender
          </Button>
          <FormNote state={state} />
        </form>
      </div>
    </Card>
  )
}
