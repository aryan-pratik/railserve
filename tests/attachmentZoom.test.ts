import { describe, expect, it } from 'vitest'
import { FIT, MAX_SCALE, clampPan, clampScale, zoomAt } from '@/components/chat/zoom'
import { previewKind } from '@/components/chat/AttachmentModal'

describe('attachment viewer zoom', () => {
  it('clamps scale between fit and the maximum', () => {
    expect(clampScale(0.2)).toBe(1)
    expect(clampScale(100)).toBe(MAX_SCALE)
    expect(clampScale(Number.NaN)).toBe(1)
    expect(clampScale(2)).toBe(2)
  })

  it('zooms around the centre without moving it', () => {
    expect(zoomAt(FIT, 2)).toEqual({ scale: 2, x: 0, y: 0 })
  })

  it('keeps the point under the cursor still', () => {
    const at = { x: 100, y: -40 }
    const v = zoomAt(FIT, 3, at)
    // Image point under the cursor before: (at - t) / s = (100, -40) / 1.
    // After: (at - t') / s' must be the same point.
    expect((at.x - v.x) / v.scale).toBeCloseTo(100)
    expect((at.y - v.y) / v.scale).toBeCloseTo(-40)
    const w = zoomAt(v, 6, at)
    expect((at.x - w.x) / w.scale).toBeCloseTo(100)
  })

  it('snaps back to centred fit when zoomed all the way out', () => {
    expect(zoomAt({ scale: 3, x: 120, y: 80 }, 0.5)).toEqual(FIT)
  })

  it('stops a pan at the image edge', () => {
    const content = { w: 400, h: 300 }
    const stage = { w: 800, h: 600 }
    // At 4x the image is 1600x1200: 400px of slack each side horizontally, 300 vertically.
    expect(clampPan({ scale: 4, x: 9999, y: -9999 }, content, stage)).toEqual({ scale: 4, x: 400, y: -300 })
    // Smaller than the stage on an axis: stays centred on it.
    expect(clampPan({ scale: 1.5, x: 50, y: 50 }, content, stage)).toEqual({ scale: 1.5, x: 0, y: 0 })
  })
})

describe('previewKind', () => {
  it('reads the WhatsApp type before the extension', () => {
    expect(previewKind('image', 'https://x/y', null)).toBe('image')
    expect(previewKind('voice', 'https://x/y', null)).toBe('audio')
    expect(previewKind('document', 'https://x/a.pdf', null)).toBe('pdf')
    expect(previewKind(null, 'https://x/clip.mp4', null)).toBe('video')
  })
})
