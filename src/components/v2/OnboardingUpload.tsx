'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload } from 'lucide-react'
import { cx } from './ui'

/**
 * Upload one document: pick a photo or a PDF, and it goes straight up. A
 * photo is shrunk in the browser first (a phone photo is often 3–4 MB), so it
 * uploads quickly on mobile data and stays well under the size limit.
 */
export function OnboardingUpload({ kind, label, again = false }: { kind: string; label: string; again?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(file: File) {
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('kind', kind)
      body.set('file', file.type.startsWith('image/') ? await shrink(file) : file)
      const res = await fetch('/api/onboarding/documents', { method: 'POST', body })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Could not upload. Please try again.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload. Please try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <span className="grid justify-items-end gap-1">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" aria-label={`Choose a file for ${label}`} onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={cx(
          'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors disabled:opacity-60',
          again ? 'bg-v2-bad text-white hover:opacity-90' : 'bg-v2-brand text-white hover:bg-v2-brand-hover',
        )}
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
        {busy ? 'Uploading…' : again ? 'Upload again' : 'Upload'}
      </button>
      {error ? <span role="alert" className="max-w-[16rem] text-right text-[12.5px] font-semibold text-v2-bad">{error}</span> : null}
    </span>
  )
}

/** A photo at most 2000px on its long side, as a JPEG: sharp enough to read, small enough to send. */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
