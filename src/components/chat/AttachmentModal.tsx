'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '@/components/Modal'
import { IconDownload } from '@/components/Icons'
import { focusRing } from '@/components/ui'

/** How an attachment can be shown inside the page. */
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'file'

const EXT: Record<string, PreviewKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', '3gp': 'video', m4v: 'video',
  mp3: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', aac: 'audio', m4a: 'audio', amr: 'audio', wav: 'audio',
  pdf: 'pdf',
}

function extOf(s: string | null): string | null {
  if (!s) return null
  let path = s
  try {
    path = new URL(s).pathname
  } catch {
    // A filename caption, not a URL.
  }
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  return m ? m[1].toLowerCase() : null
}

/**
 * Picks the preview from what WhatsApp called the attachment, falling back
 * to the file extension in the URL or the filename caption. Lines stored
 * before the type was kept have only the URL to go on; with nothing to tell,
 * it guesses an image, and the image's own load error drops it to a framed
 * preview.
 */
export function previewKind(mediaType: string | null, url: string, caption: string | null): PreviewKind {
  const byExt = EXT[extOf(url) ?? ''] ?? EXT[extOf(caption) ?? '']
  switch (mediaType) {
    case 'image':
    case 'sticker':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
    case 'voice':
      return 'audio'
    case 'document':
      return byExt === 'pdf' || byExt === 'image' ? byExt : byExt ? 'file' : 'pdf'
    default:
      return byExt ?? 'image'
  }
}

/**
 * The attachment opened over the thread instead of in a new tab, so the
 * telecaller never leaves the conversation they are answering. Download and
 * a plain new-tab link stay in the footer for the file a browser cannot draw.
 */
export function AttachmentModal({
  url,
  kind: initialKind,
  caption,
  onClose,
}: {
  url: string
  kind: PreviewKind
  caption: string | null
  onClose: () => void
}) {
  // An image that will not decode is most often a PDF or a page behind a
  // URL with no extension: let the browser's own viewer try it in a frame.
  const [kind, setKind] = useState(initialKind)

  // Portalled out of the thread: the message list is an aria-live region
  // and the panel should not be read out as a new line in it.
  return createPortal(
    <Modal
      title={caption ?? 'Attachment'}
      titleId="chat-attachment-title"
      onClose={onClose}
      maxWidthClassName="max-w-4xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-sunken hover:text-ink ${focusRing}`}
          >
            Open in new tab
          </a>
          <a
            href={url}
            download
            className={`inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 ${focusRing}`}
          >
            <IconDownload size={15} aria-hidden /> Download
          </a>
        </div>
      }
    >
      <div className="flex min-h-48 items-center justify-center bg-canvas p-3">
        {kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- a provider URL on any host; next/image would need each one allow-listed
          <img
            src={url}
            alt={caption ?? 'Attachment'}
            onError={() => setKind('pdf')}
            className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
          />
        ) : kind === 'video' ? (
          <video src={url} controls autoPlay className="max-h-[70vh] w-full rounded-md bg-black" />
        ) : kind === 'audio' ? (
          <audio src={url} controls autoPlay className="w-full max-w-md" />
        ) : kind === 'pdf' ? (
          <iframe src={url} title={caption ?? 'Attachment'} className="h-[70vh] w-full rounded-md border-0 bg-surface" />
        ) : (
          <p className="px-6 py-10 text-center text-sm text-muted text-pretty">
            This file cannot be previewed here. Download it to open it.
          </p>
        )}
      </div>
    </Modal>,
    document.body,
  )
}
