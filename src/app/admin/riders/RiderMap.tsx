'use client'

import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { RiderView } from '@/lib/repo/riderLocationRepo'
import { PRESENCE_LABEL, ageLabel, speedLabel } from '@/lib/riderLocation'

/** Where the map opens when no rider has ever reported: roughly central India. */
const FALLBACK_CENTRE: [number, number] = [22.9734, 78.6569]
const FALLBACK_ZOOM = 5

/** Close enough to read a platform, far enough to keep the station in frame. */
const SINGLE_RIDER_ZOOM = 16

/**
 * Marker colour per presence, matching the badges in the list beside it, so
 * the two halves of the page are obviously about the same thing.
 */
const TONE: Record<string, { dot: string; ring: string }> = {
  LIVE: { dot: '#059669', ring: 'rgba(5,150,105,0.25)' },
  IDLE: { dot: '#d97706', ring: 'rgba(217,119,6,0.22)' },
  OFFLINE: { dot: '#64748b', ring: 'rgba(100,116,139,0.20)' },
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

/**
 * Riders on a map.
 *
 * Leaflet, driven directly rather than through a React wrapper. The wrapper
 * libraries want to own the map's lifecycle, and this map is re-fed every ten
 * seconds from a poll: re-rendering markers as components would fight the pan
 * and zoom the admin has set, which is the one piece of state on this page
 * that belongs to the person rather than the server. So the map is created
 * once and the markers are swapped inside it, leaving the viewport alone.
 *
 * The map is only auto-fitted once, on the first load that has anyone to show.
 * After that the view is the operator's — a board that yanked itself back to
 * "fit everyone" every ten seconds would be unusable the moment you zoomed in
 * on the rider you were actually watching.
 *
 * Tiles come from OpenStreetMap's public servers, which need no key and no
 * account. That is the right trade for a handful of admin screens; a paid tile
 * provider is a one-line swap here if this ever grows past that.
 */
export function RiderMap({
  riders,
  focusRiderId,
}: {
  riders: RiderView[]
  /** Pan to this rider when it changes — the list's "show on map" button. */
  focusRiderId: string | null
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<LeafletMap | null>(null)
  const markerLayer = useRef<LayerGroup | null>(null)
  const fitted = useRef(false)
  const focused = useRef<string | null>(null)

  // Leaflet reaches for `window` at import time, so it cannot be a module-level
  // import in a tree Next also renders on the server.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !holder.current || map.current) return

      const instance = L.map(holder.current, {
        center: FALLBACK_CENTRE,
        zoom: FALLBACK_ZOOM,
        // The page scrolls; a wheel over the map should scroll it too rather
        // than zooming out from under the cursor. Ctrl-wheel and the buttons
        // still zoom.
        scrollWheelZoom: false,
      })

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(instance)

      markerLayer.current = L.layerGroup().addTo(instance)
      map.current = instance
    })()

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
      markerLayer.current = null
    }
  }, [])

  // Redraw the markers on every poll. Cheap — this is tens of markers, and
  // Leaflet is doing the same work a keyed React list would.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = (await import('leaflet')).default
      const layer = markerLayer.current
      const instance = map.current
      if (cancelled || !layer || !instance) return

      layer.clearLayers()

      const placed = riders.filter(
        (r) => r.position !== null && r.presence !== 'NEVER',
      )

      for (const rider of placed) {
        const pos = rider.position!
        const tone = TONE[rider.presence] ?? TONE.OFFLINE
        const initials = rider.name
          .split(/\s+/)
          .map((part) => part[0] ?? '')
          .join('')
          .slice(0, 2)
          .toUpperCase()

        // The path walked in the last few minutes, so a still marker and a
        // moving one look different at a glance.
        if (rider.trail.length > 1) {
          L.polyline(
            rider.trail.map((p) => [p.lat, p.lng] as [number, number]),
            { color: tone.dot, weight: 3, opacity: rider.presence === 'LIVE' ? 0.55 : 0.3 },
          ).addTo(layer)
        }

        // The device's own accuracy, drawn rather than hidden: a 400m circle
        // says "this is a tower fix, do not send anyone to this dot".
        if (pos.accuracyMetres && pos.accuracyMetres > 40) {
          L.circle([pos.lat, pos.lng], {
            radius: pos.accuracyMetres,
            color: tone.dot,
            weight: 1,
            opacity: 0.4,
            fillColor: tone.dot,
            fillOpacity: 0.08,
          }).addTo(layer)
        }

        // divIcon rather than an image marker: Leaflet's default marker points
        // at PNGs by a relative URL that the bundler rewrites, which is the
        // classic broken-image-pin. Inline markup has no such path.
        const marker = L.marker([pos.lat, pos.lng], {
          title: rider.name,
          icon: L.divIcon({
            className: '',
            html: `<div style="
                     display:flex;align-items:center;justify-content:center;
                     width:30px;height:30px;border-radius:9999px;
                     background:${tone.dot};color:#fff;
                     font:600 11px/1 ui-sans-serif,system-ui,sans-serif;
                     border:2px solid #fff;
                     box-shadow:0 0 0 4px ${tone.ring},0 1px 3px rgba(0,0,0,.35);
                   ">${escapeHtml(initials)}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        }).addTo(layer)

        const lines = [
          `<strong>${escapeHtml(rider.name)}</strong>`,
          `${PRESENCE_LABEL[rider.presence]} · ${ageLabel(pos.recordedAt)}`,
          rider.work.carrying > 0
            ? `Carrying ${rider.work.carrying} order${rider.work.carrying === 1 ? '' : 's'}`
            : 'Carrying nothing',
          speedLabel(pos.speedMetresPerSecond),
          pos.accuracyMetres ? `±${Math.round(pos.accuracyMetres)}m` : null,
        ].filter(Boolean)
        marker.bindPopup(lines.join('<br/>'))
      }

      // First load with anyone on it decides the view, and then never again.
      if (!fitted.current && placed.length > 0) {
        fitted.current = true
        if (placed.length === 1) {
          instance.setView(
            [placed[0].position!.lat, placed[0].position!.lng],
            SINGLE_RIDER_ZOOM,
          )
        } else {
          instance.fitBounds(
            placed.map((r) => [r.position!.lat, r.position!.lng] as [number, number]),
            { padding: [40, 40], maxZoom: SINGLE_RIDER_ZOOM },
          )
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [riders])

  // Panning to one rider is an explicit request from the list, so unlike the
  // refresh it is allowed to move the view — but only when the request itself
  // changes, never on the poll that follows it.
  useEffect(() => {
    if (!focusRiderId || focusRiderId === focused.current) return
    const target = riders.find((r) => r.id === focusRiderId)
    if (!target?.position || !map.current) return
    focused.current = focusRiderId
    map.current.setView([target.position.lat, target.position.lng], SINGLE_RIDER_ZOOM, {
      animate: true,
    })
    map.current.invalidateSize()
  }, [focusRiderId, riders])

  return (
    <div
      ref={holder}
      role="application"
      aria-label="Map of rider positions"
      className="h-[26rem] w-full rounded-lg bg-sunken sm:h-[32rem]"
    />
  )
}
