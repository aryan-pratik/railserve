'use client'

import { useState } from 'react'
import { IconCheck, IconCopy } from './Icons'
import { IconButton } from './ui'
import { copyText } from '@/lib/copyText'

/**
 * Copies `text` to the clipboard on click and flashes a checkmark for a
 * moment so the admin has proof it worked before the tooltip goes away.
 *
 * Hidden until the row is hovered/focused (`group-hover:opacity-100` on the
 * caller's side), so it never competes with the room a compact row needs.
 * On touch devices there's no hover to reveal it, so the caller also sets
 * `pointer-coarse:opacity-100` to keep it visible there.
 */
export function CopyButton({
  text,
  label,
  className = '',
}: {
  text: string
  /** What's being copied, e.g. "Copy train details" — read by screen readers and shown as a tooltip. */
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <IconButton
      size="sm"
      aria-label={label}
      title={copied ? 'Copied' : label}
      onClick={copy}
      className={className}
    >
      {copied ? <IconCheck size={14} className="text-emerald-600" /> : <IconCopy size={14} />}
    </IconButton>
  )
}
