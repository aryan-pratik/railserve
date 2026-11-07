/**
 * Pan-and-zoom arithmetic for the attachment viewer, kept apart from the
 * component so it can be unit-tested without a DOM.
 *
 * The image is laid out "fit" (object-contain) inside the stage, and a CSS
 * transform `translate(x, y) scale(s)` with origin at its centre is applied on
 * top. All points are in stage pixels measured from the stage's centre.
 */
export type View = { scale: number; x: number; y: number }

export const FIT: View = { scale: 1, x: 0, y: 0 }
export const MIN_SCALE = 1
export const MAX_SCALE = 8
/** Each button press or key press multiplies (or divides) the scale by this. */
export const STEP = 1.5

export function clampScale(s: number): number {
  if (!Number.isFinite(s)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

/**
 * Keeps the image covering the stage once it is bigger than it, and centred
 * on an axis where it is smaller: never dragged off into empty space.
 * `content` is the image's fitted (unscaled) size, `stage` the viewport's.
 */
export function clampPan(v: View, content: { w: number; h: number }, stage: { w: number; h: number }): View {
  const maxX = Math.max(0, (content.w * v.scale - stage.w) / 2)
  const maxY = Math.max(0, (content.h * v.scale - stage.h) / 2)
  return {
    scale: v.scale,
    x: Math.min(maxX, Math.max(-maxX, v.x)),
    y: Math.min(maxY, Math.max(-maxY, v.y)),
  }
}

/**
 * Scales to `next` while holding the image point under `at` (the cursor, or
 * the pinch midpoint) still on screen. Zooming back to fit recentres.
 */
export function zoomAt(v: View, next: number, at: { x: number; y: number } = { x: 0, y: 0 }): View {
  const scale = clampScale(next)
  if (scale === MIN_SCALE) return FIT
  const k = scale / v.scale
  return { scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }
}
