'use client'

import { useActionState } from 'react'
import { ingestPastedEmail, type InboxState } from '@/app/v2/inbox/actions'
import { Notice } from './Table'
import { Button, Card, cx, v2Focus } from './ui'

const initial: InboxState = {}

export const inboxTextareaClass = cx(
  'w-full rounded-v2-md border border-v2-line bg-v2-surface p-3 font-mono text-xs leading-relaxed text-v2-ink placeholder:text-v2-faint',
  v2Focus,
)

/** Paste an email; it takes the same path as one that arrived by Gmail. */
export function InboxPasteCard() {
  const [state, action, pending] = useActionState(ingestPastedEmail, initial)

  return (
    <Card title="Ingest an email by hand">
      <form action={action} className="grid gap-3">
        <p className="text-sm text-v2-muted">
          Paste an aggregator order email or a bank alert. It goes through the same parser, outlet matching and duplicate handling as live Gmail ingestion.
        </p>
        <textarea
          aria-label="Paste the raw order email"
          name="body"
          rows={8}
          required
          placeholder={'*Order From YatriRestro*\n*Order Id : #1000584805*\n…'}
          className={inboxTextareaClass}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Ingesting…' : 'Ingest'}
          </Button>
          {state.ok ? <Notice tone="ok" className="py-2">{state.ok}</Notice> : null}
          {state.error ? <Notice tone="bad" className="py-2">{state.error}</Notice> : null}
        </div>
      </form>
    </Card>
  )
}
