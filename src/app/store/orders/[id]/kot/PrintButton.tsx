'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'

export function PrintButton({ printUrl }: { printUrl: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePrint() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(printUrl, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? `Print failed (${res.status})`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" onClick={handlePrint} pending={pending}>
        Print
      </Button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}
