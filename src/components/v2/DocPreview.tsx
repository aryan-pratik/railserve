'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ExternalLink, FileText } from 'lucide-react'
import { RiderDialog } from './RiderDialog'
import { cx, v2Focus } from './ui'

/**
 * An uploaded document, opened in a window over the page rather than a new
 * tab: a photo shown whole, a PDF in a viewer. "Open in a new tab" and
 * "Download" stay at the bottom for a closer look.
 */
export function DocPreview({ href, fileName, title, className, children }: { href: string; fileName: string; title: string; className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pdf = /\.pdf$/i.test(fileName)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cx('text-left text-v2-brand underline underline-offset-2 hover:text-v2-brand-hover', v2Focus, className)}>
        {children ?? fileName}
      </button>
      {/* Rendered at the end of the page, not where the link sits: the link is
          often inside a paragraph, which cannot hold a window. */}
      {open ? createPortal(
        <RiderDialog
          title={title}
          titleId="doc-preview"
          note={fileName}
          onClose={() => setOpen(false)}
          width="max-w-4xl"
          footer={
            <>
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold text-v2-ink-2 hover:bg-v2-surface-2">
                <ExternalLink size={15} aria-hidden />
                Open in a new tab
              </a>
              <a href={href} download={fileName} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-v2-brand px-4 text-[13.5px] font-bold text-white hover:bg-v2-brand-hover">
                <Download size={15} aria-hidden />
                Download
              </a>
            </>
          }
        >
          {pdf ? (
            <div className="grid gap-2">
              <iframe src={href} title={`${title}: ${fileName}`} className="h-[70dvh] w-full rounded-v2-md border border-v2-line bg-v2-surface-2" />
              <p className="flex items-center gap-1.5 text-[12.5px] text-v2-muted">
                <FileText size={14} aria-hidden />
                If the PDF does not show here (some phones), use Open in a new tab.
              </p>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a private, authenticated file; next/image would proxy and cache it
            <img src={href} alt={`${title}: ${fileName}`} className="mx-auto max-h-[72dvh] w-auto max-w-full rounded-v2-md border border-v2-line object-contain" />
          )}
        </RiderDialog>,
        document.body,
      ) : null}
    </>
  )
}
