'use client'

import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button, cx, v2Focus } from './ui'

/**
 * Reprints the KOTs already in the kitchen for one train, without moving any
 * status: a recovery action (jam, torn ticket), so it posts to the print
 * route and stays put. `menu` renders it as a row in the footer's overflow.
 */
export function KitchenReprintButton({ runKey, count, menu = false }: { runKey: string; count: number; menu?: boolean }) {
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null)

  async function reprint() {
    setPending(true)
    setNote(null)
    try {
      const res = await fetch(`/api/store/runs/${encodeURIComponent(runKey)}/kot`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Reprint failed (${res.status})`)
      setNote({ ok: `Sent ${body.count ?? count} to the printer.` })
    } catch (err) {
      setNote({ error: err instanceof Error ? err.message : 'Reprint failed' })
    } finally {
      setPending(false)
    }
  }

  const label = `Reprint ${count} KOT${count === 1 ? '' : 's'}`
  const feedback = note ? (
    <span role={note.error ? 'alert' : 'status'} className={cx('block text-xs font-semibold', note.error ? 'text-v2-bad' : 'text-v2-brand')}>
      {note.error ?? note.ok}
    </span>
  ) : null

  if (menu) {
    return (
      <div>
        <button
          type="button"
          onClick={() => void reprint()}
          disabled={pending}
          className={cx('flex w-full items-center gap-2 rounded-v2-sm px-3 py-2 text-left text-sm font-semibold hover:bg-v2-surface-2 disabled:opacity-50', v2Focus)}
        >
          {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
          {label}
        </button>
        {feedback ? <div className="px-3 pb-1">{feedback}</div> : null}
      </div>
    )
  }

  return (
    <span className="grid justify-items-end gap-1">
      <Button type="button" onClick={() => void reprint()} disabled={pending}>
        {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RotateCcw size={15} aria-hidden />}
        {label}
      </Button>
      {feedback}
    </span>
  )
}
