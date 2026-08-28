'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Capture a delivery photo and put it in the bucket before the form submits.
 *
 * `capture="environment"` opens the rear camera directly on a phone rather than
 * a file browser — the rider is standing at a train door, not picking files.
 *
 * The image is downscaled in the browser first. A modern phone camera produces
 * 3-5 MB per shot, and this uploads from a platform on a connection that barely
 * works; 1280px at quality 0.8 lands around 150-250 KB and is far more than
 * enough to recognise a handover. Uploading the original would be the single
 * slowest thing a rider does all day.
 *
 * The upload goes straight to the object store from the device. On success the
 * object key — never the presigned URL, which expires — goes into a hidden
 * field, and the parent form submits it as `proofKey`.
 */
const MAX_EDGE = 1280
const QUALITY = 0.8

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'done'; preview: string }
  | { kind: 'error'; message: string }

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not read that image'))),
      'image/jpeg',
      QUALITY,
    )
  })
}

export function ProofPhotoField({
  orderId,
  requestUpload,
}: {
  orderId: string
  requestUpload: (
    orderId: string,
    contentType: string,
  ) => Promise<{ uploadUrl: string; key: string } | { error: string }>
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [key, setKey] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function onPick(file: File) {
    try {
      setStatus({ kind: 'working', label: 'Preparing…' })
      const blob = await downscale(file)

      const signed = await requestUpload(orderId, 'image/jpeg')
      if ('error' in signed) {
        setStatus({ kind: 'error', message: signed.error })
        return
      }

      setStatus({ kind: 'working', label: 'Uploading…' })
      const res = await fetch(signed.uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': 'image/jpeg' },
      })
      if (!res.ok) {
        setStatus({ kind: 'error', message: `Upload failed (${res.status}). You can still deliver without a photo.` })
        return
      }

      setKey(signed.key)
      setStatus({ kind: 'done', preview: URL.createObjectURL(blob) })
    } catch {
      setStatus({
        kind: 'error',
        message: 'Could not attach the photo. You can still deliver without one.',
      })
    }
  }

  return (
    <div className="space-y-2">
      {/* Empty until an upload succeeds, so a failed photo never blocks delivery. */}
      <input type="hidden" name="proofKey" value={key} />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take a delivery photo"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onPick(file)
        }}
      />

      {status.kind === 'done' ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob: preview of the just-taken photo, not a served asset */}
          <img
            src={status.preview}
            alt="Delivery photo just taken"
            className="size-16 rounded-lg border border-line object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-emerald-700">Photo attached</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Retake
            </button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={status.kind === 'working'}
          onClick={() => inputRef.current?.click()}
        >
          {status.kind === 'working' ? status.label : '📷 Take delivery photo'}
        </Button>
      )}

      {status.kind === 'error' ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {status.message}
        </p>
      ) : null}
    </div>
  )
}
