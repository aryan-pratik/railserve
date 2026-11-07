'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDownload,
  IconExternal,
  IconShrink,
  IconZoomIn,
  IconZoomOut,
} from '@/components/Icons'
import { formatTimeIST } from '@/lib/format'
import { FIT, MAX_SCALE, MIN_SCALE, STEP, clampPan, zoomAt, type View } from './zoom'

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

/** One attachment in the thread, in the order the thread shows them. */
export type Attachment = {
  id: string
  url: string
  kind: PreviewKind
  caption: string | null
  at: string
  out: boolean
  sender: string | null
}

const KIND_LABEL: Record<PreviewKind, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice note',
  pdf: 'Document',
  file: 'File',
}

const toolBtn =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70'

/**
 * The thread's attachments opened over it as a full-screen viewer, so the
 * telecaller never leaves the conversation they are answering. Photos zoom
 * (toolbar, wheel, pinch, double-click, + / - / 0) and pan by dragging;
 * ← / → step through every attachment in the thread; Esc closes.
 */
export function AttachmentModal({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: Attachment[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const item = items[index]
  const panelRef = useRef<HTMLDivElement>(null)
  // An image that will not decode is most often a PDF or a page behind a URL
  // with no extension: let the browser's own viewer try it in a frame. Kept
  // per attachment so stepping back to it does not retry the broken image.
  const [fallback, setFallback] = useState<Record<string, PreviewKind>>({})
  const kind = item ? (fallback[item.id] ?? item.kind) : 'file'
  const [view, setView] = useState<View>(FIT)
  const stageRef = useRef<{ zoom: (factor: number) => void; reset: () => void } | null>(null)

  const hasPrev = index > 0
  const hasNext = index < items.length - 1
  const prev = useCallback(() => hasPrev && onIndex(index - 1), [hasPrev, index, onIndex])
  const next = useCallback(() => hasNext && onIndex(index + 1), [hasNext, index, onIndex])

  // Focus, scroll-lock and returning focus to the opener: once per open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') return onClose()
      // A focused player keeps its own arrow keys (seek, volume).
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO' || t.tagName === 'INPUT')) return
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (kind !== 'image') return
      else if (e.key === '+' || e.key === '=') stageRef.current?.zoom(STEP)
      else if (e.key === '-' || e.key === '_') stageRef.current?.zoom(1 / STEP)
      else if (e.key === '0') stageRef.current?.reset()
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, prev, next, kind])

  if (!item) return null
  const title = item.caption?.trim() || KIND_LABEL[kind]
  const meta = [
    KIND_LABEL[kind],
    item.out ? (item.sender ? `Sent by ${item.sender}` : 'Sent') : 'Received',
    formatTimeIST(item.at),
  ].join(' · ')
  const zoomed = view.scale > MIN_SCALE

  // Portalled out of the thread: the message list is an aria-live region
  // and the viewer should not be read out as a new line in it.
  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-attachment-title"
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 text-white outline-none backdrop-blur-sm"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-black/40 py-2 pl-4 pr-2 sm:pl-5">
        <div className="min-w-0 flex-1">
          <h2 id="chat-attachment-title" className="truncate text-sm font-semibold" title={title}>
            {title}
          </h2>
          <p className="truncate text-xs text-white/60 tabular-nums">
            {meta}
            {items.length > 1 ? ` · ${index + 1} of ${items.length}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Attachment actions">
          {kind === 'image' ? (
            <>
              <button type="button" className={toolBtn} onClick={() => stageRef.current?.zoom(1 / STEP)} disabled={!zoomed} aria-label="Zoom out" title="Zoom out (−)">
                <IconZoomOut size={18} />
              </button>
              <button
                type="button"
                onClick={() => stageRef.current?.reset()}
                disabled={!zoomed}
                title="Fit to screen (0)"
                aria-label={`Zoom ${Math.round(view.scale * 100)}%, reset to fit`}
                className="hidden h-9 min-w-14 rounded-lg px-1.5 text-xs font-medium text-white/80 tabular-nums transition-colors hover:bg-white/10 hover:text-white disabled:text-white/60 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:block"
              >
                {Math.round(view.scale * 100)}%
              </button>
              <button type="button" className={toolBtn} onClick={() => stageRef.current?.zoom(STEP)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in" title="Zoom in (+)">
                <IconZoomIn size={18} />
              </button>
              <button type="button" className={`${toolBtn} max-sm:hidden`} onClick={() => stageRef.current?.reset()} disabled={!zoomed} aria-label="Fit to screen" title="Fit to screen (0)">
                <IconShrink size={17} />
              </button>
              <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
            </>
          ) : null}
          <a href={item.url} download className={toolBtn} aria-label="Download" title="Download">
            <IconDownload size={18} />
          </a>
          <a href={item.url} target="_blank" rel="noreferrer" className={toolBtn} aria-label="Open in new tab" title="Open in new tab">
            <IconExternal size={18} />
          </a>
          <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
          <button type="button" className={toolBtn} onClick={onClose} aria-label="Close" title="Close (Esc)">
            <IconClose size={20} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {kind === 'image' ? (
          <ImageStage
            key={item.id}
            src={item.url}
            alt={item.caption ?? 'Attachment'}
            onView={setView}
            controlRef={stageRef}
            onBackdrop={onClose}
            onError={() => setFallback((f) => ({ ...f, [item.id]: 'pdf' }))}
          />
        ) : (
          <Backdrop onClose={onClose}>
            {kind === 'video' ? (
              <video key={item.id} src={item.url} controls autoPlay className="max-h-full max-w-full rounded-lg bg-black shadow-2xl" />
            ) : kind === 'audio' ? (
              <div className="w-full max-w-md rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                <p className="mb-3 text-center text-sm text-white/70">{KIND_LABEL.audio}</p>
                <audio key={item.id} src={item.url} controls autoPlay className="w-full" />
              </div>
            ) : kind === 'pdf' ? (
              <iframe key={item.id} src={item.url} title={title} className="h-full w-full max-w-5xl rounded-lg border-0 bg-white shadow-2xl" />
            ) : (
              <div className="max-w-sm rounded-2xl bg-white/5 px-6 py-8 text-center ring-1 ring-white/10">
                <p className="text-sm text-white/80 text-pretty">This file cannot be previewed here.</p>
                <a
                  href={item.url}
                  download
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <IconDownload size={15} aria-hidden /> Download
                </a>
              </div>
            )}
          </Backdrop>
        )}

        {hasPrev ? (
          <NavButton side="left" onClick={prev} label="Previous attachment">
            <IconChevronLeft size={22} />
          </NavButton>
        ) : null}
        {hasNext ? (
          <NavButton side="right" onClick={next} label="Next attachment">
            <IconChevronRight size={22} />
          </NavButton>
        ) : null}
      </div>

      {kind === 'image' ? (
        <p className="pointer-events-none shrink-0 pb-2 text-center text-[11px] text-white/45 max-sm:hidden">
          Scroll or pinch to zoom · drag to pan · double-click to toggle zoom
        </p>
      ) : null}
    </div>,
    document.body,
  )
}

function Backdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-4 sm:px-16 sm:py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )
}

function NavButton({ side, onClick, label, children }: { side: 'left' | 'right'; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`absolute top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        side === 'left' ? 'left-2 sm:left-4' : 'right-2 sm:right-4'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * The photo fitted to the stage, with zoom and pan applied as a transform on
 * top. Wheel zooms around the cursor, two fingers pinch around their
 * midpoint, one pointer drags when zoomed in.
 */
function ImageStage({
  src,
  alt,
  onView,
  onBackdrop,
  onError,
  controlRef,
}: {
  src: string
  alt: string
  onView: (v: View) => void
  onBackdrop: () => void
  onError: () => void
  controlRef: React.RefObject<{ zoom: (factor: number) => void; reset: () => void } | null>
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [view, setViewState] = useState<View>(FIT)
  const viewRef = useRef(view)
  const [animate, setAnimate] = useState(true)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    dist: number
    scale: number
    moved: boolean
    last: { x: number; y: number } | null
    /** The press began on the dark area, not the photo. */
    onBackdrop: boolean
  }>({ dist: 0, scale: 1, moved: false, last: null, onBackdrop: false })

  const apply = useCallback(
    (v: View, smooth: boolean) => {
      const img = imgRef.current
      const el = stageRef.current
      const clamped =
        img && el ? clampPan(v, { w: img.offsetWidth, h: img.offsetHeight }, { w: el.clientWidth, h: el.clientHeight }) : v
      viewRef.current = clamped
      setAnimate(smooth)
      setViewState(clamped)
      onView(clamped)
    },
    [onView],
  )

  // Stage-centred coordinates of a client point.
  const local = useCallback((cx: number, cy: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 }
  }, [])

  useLayoutEffect(() => {
    onView(FIT)
    controlRef.current = {
      zoom: (f) => apply(zoomAt(viewRef.current, viewRef.current.scale * f), true),
      reset: () => apply(FIT, true),
    }
    return () => {
      controlRef.current = null
    }
  }, [apply, controlRef, onView])

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse
      // wheel notch is ~100. Both map smoothly onto an exponential scale.
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
      const v = viewRef.current
      apply(zoomAt(v, v.scale * k, local(e.clientX, e.clientY)), false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [apply, local])

  // Re-clamp when the window resizes and the fitted size changes.
  useEffect(() => {
    const onResize = () => apply(viewRef.current, false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [apply])

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Read before capturing: once captured, every later event targets the stage.
    if (pointers.current.size === 0) gesture.current.onBackdrop = e.target === e.currentTarget
    stageRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (pointers.current.size === 1) {
      g.moved = false
      g.last = { x: e.clientX, y: e.clientY }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      g.dist = Math.hypot(a.x - b.x, a.y - b.y)
      g.scale = viewRef.current.scale
      g.moved = true
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (g.dist > 0) {
        const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2)
        apply(zoomAt(viewRef.current, (g.scale * dist) / g.dist, mid), false)
      }
      return
    }
    if (!g.last) return
    const dx = e.clientX - g.last.x
    const dy = e.clientY - g.last.y
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
    g.last = { x: e.clientX, y: e.clientY }
    const v = viewRef.current
    if (v.scale > MIN_SCALE) apply({ ...v, x: v.x + dx, y: v.y + dy }, false)
  }

  function onPointerUp(e: React.PointerEvent) {
    const wasTap = pointers.current.size === 1 && !gesture.current.moved
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 1) {
      // One finger lifted mid-pinch: carry on as a drag from the other.
      const [p] = [...pointers.current.values()]
      gesture.current.last = p
    } else if (pointers.current.size === 0) {
      gesture.current.last = null
    }
    // A tap on the dark area around a photo at fit closes, like a lightbox.
    if (wasTap && e.type === 'pointerup' && gesture.current.onBackdrop && viewRef.current.scale === MIN_SCALE) onBackdrop()
  }

  function onDoubleClick(e: React.MouseEvent) {
    const v = viewRef.current
    apply(v.scale > MIN_SCALE ? FIT : zoomAt(v, 2.5, local(e.clientX, e.clientY)), true)
  }

  const zoomed = view.scale > MIN_SCALE
  return (
    <div
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      className={`relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden p-4 sm:px-16 sm:py-6 ${
        zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a provider URL on any host; next/image would need each one allow-listed */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        onError={onError}
        style={{
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          transition: animate ? 'transform 160ms ease-out' : 'none',
        }}
        className="max-h-full max-w-full rounded-md object-contain shadow-2xl will-change-transform"
      />
    </div>
  )
}
