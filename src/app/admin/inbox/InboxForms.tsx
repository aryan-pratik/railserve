'use client'

import { useActionState, useState } from 'react'
import { Button, Card, CardHeader, FormNote, inputClass } from '@/components/ui'
import { ingestPastedEmail, resolveUnparsed, type InboxState } from './actions'

const initial: InboxState = {}

export function PasteEmailForm() {
  const [state, action, pending] = useActionState(ingestPastedEmail, initial)

  return (
    <Card>
      <CardHeader title="Ingest an email by hand" />
      <form action={action} className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Paste an aggregator order email. It goes through the same parser,
          outlet matching and duplicate handling as live Gmail ingestion.
        </p>
        <textarea
          aria-label="Paste the raw order email"
          name="body" rows={10} required
          placeholder="*Order From YatriRestro*&#10;*Order Id : #1000584805*&#10;..."
          className={`${inputClass} font-mono text-xs`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Ingesting…' : 'Ingest'}
          </Button>
          <FormNote state={state} />
        </div>
      </form>
    </Card>
  )
}

export function ResolveForm({ id, body }: { id: string; body: string }) {
  const [state, action, pending] = useActionState(resolveUnparsed, initial)
  const [open, setOpen] = useState(false)

  // Closed, this is one of two buttons on the row; open, it takes the full
  // width so the raw email is editable at the width it was written.
  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Correct and re-ingest
      </Button>
    )
  }

  return (
    <form action={action} className="w-full space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea name="body" rows={12} defaultValue={body}
        aria-label="Corrected order email, re-ingested on save"
        className={`${inputClass} font-mono text-xs`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Re-ingesting…' : 'Re-ingest'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}
