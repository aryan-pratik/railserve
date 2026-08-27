'use client'

import { useActionState, useState } from 'react'
import { Card, CardHeader, inputClass } from '@/components/ui'
import { ingestPastedEmail, resolveUnparsed, type InboxState } from './actions'

const initial: InboxState = {}

export function PasteEmailForm() {
  const [state, action, pending] = useActionState(ingestPastedEmail, initial)

  return (
    <Card>
      <CardHeader title="Ingest an email by hand" />
      <form action={action} className="space-y-3 p-4">
        <p className="text-sm text-slate-600">
          Paste an aggregator order email. It goes through the same parser,
          outlet matching and duplicate handling as live Gmail ingestion.
        </p>
        <textarea
          name="body" rows={10} required
          placeholder="*Order From YatriRestro*&#10;*Order Id : #1000584805*&#10;..."
          className={`${inputClass} font-mono text-xs`}
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {pending ? 'Ingesting…' : 'Ingest'}
          </button>
          {state.error ? <span className="text-sm font-medium text-red-600">{state.error}</span> : null}
          {state.ok ? <span className="text-sm font-medium text-emerald-700">{state.ok}</span> : null}
        </div>
      </form>
    </Card>
  )
}

export function ResolveForm({ id, body }: { id: string; body: string }) {
  const [state, action, pending] = useActionState(resolveUnparsed, initial)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Correct and re-ingest
      </button>
    )
  }

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea name="body" rows={12} defaultValue={body}
        className={`${inputClass} font-mono text-xs`} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          {pending ? 'Re-ingesting…' : 'Re-ingest'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        {state.error ? <span className="text-sm font-medium text-red-600">{state.error}</span> : null}
        {state.ok ? <span className="text-sm font-medium text-emerald-700">{state.ok}</span> : null}
      </div>
    </form>
  )
}
