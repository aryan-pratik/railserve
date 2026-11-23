'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cx, v2Focus } from './ui'
import { copyText } from '@/lib/copyText'

/** Copies `text` and flashes a tick so there is proof it worked. */
export function CallsCopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={copied ? 'Copied' : label}
      onClick={copy}
      className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full border border-v2-line text-v2-ink-2 hover:bg-v2-surface-2', v2Focus, className)}
    >
      {copied ? <Check size={14} className="text-v2-ok" aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  )
}
