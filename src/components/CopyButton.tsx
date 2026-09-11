'use client'

import { useState } from 'react'
import { IconCheck, IconCopy } from './Icons'
import { IconButton } from './ui'

/**
 * Copies `text` to the clipboard on click and flashes a checkmark for a
 * moment so the admin has proof it worked before the tooltip goes away.
 *
 * Hidden until the row is hovered/focused (`group-hover:opacity-100` on the
 * caller's side), so it never competes with the room a compact row needs.
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
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access denied or unavailable; nothing useful to recover into.
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
