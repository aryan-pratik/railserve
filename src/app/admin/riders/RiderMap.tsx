'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, LayerGroup, Marker, Polyline, Circle } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { RiderView } from '@/lib/repo/riderLocationRepo'
import { ageLabel, speedLabel } from '@/lib/riderLocation'
import { STATUS_TONE, boardStatusOf, initialsOf, statusLabelOf } from './riderStatus'

/** Where the map opens when no rider has ever reported: roughly central India. */
const FALLBACK_CENTRE: [number, number] = [22.9734, 78.6569]
const FALLBACK_ZOOM = 5

/** Close enough to read a platform, far enough to keep the station in frame. */
const SINGLE_RIDER_ZOOM = 16

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

/** What the map holds for one rider, kept between polls so it can be moved rather than redrawn. */
type Drawn = {
  marker: Marker
  /** The icon's markup, so it is only replaced when it would look different. */
  iconHtml: string
  trail: Polyline | null
  accuracy: Circle | null
}

/**
 * The marker's face: a disc in the rider's status colour with their initials,
 * and beside it a small tag repeating them with status and station — so the
 * map can be read without clicking anything. The selected rider is drawn
 * larger and ringed in the accent, the same colour that marks their row.
 *
 * The disc's centre is the position; the tag hangs off to the right.
 */
function markerHtml(rider: RiderView, selected: boolean): string {
  const tone = STATUS_TONE[boardStatusOf(rider)]
  const disc = selected ? DISC_SELECTED : DISC
  const halo = selected
    ? `0 0 0 3px #fff,0 0 0 5px var(--color-accent),0 2px 6px rgba(13,20,36,.35)`
    : `0 0 0 4px ${tone.halo},0 1px 3px rgba(13,20,36,.35)`
  const detail = [statusLabelOf(rider), rider.work.stations[0]].filter(Boolean).join(' · ')
  return `<div style="position:relative;width:${disc}px;height:${disc}px;font-family:var(--font-sans)">
            <div style="
              display:flex;align-items:center;justify-content:center;
              width:${disc}px;height:${disc}px;border-radius:9999px;
              background:${tone.hex};color:#fff;
              font-weight:600;font-size:${selected ? 12 : 11}px;line-height:1;
              border:2px solid #fff;box-shadow:${halo};
            ">${escapeHtml(initialsOf(rider.name))}</div>
            <div style="
              position:absolute;left:${disc + 6}px;top:50%;transform:translateY(-50%);
              white-space:nowrap;padding:3px 7px;border-radius:7px;
              background:rgba(255,255,255,.96);color:#0d1424;
              box-shadow:0 0 0 1px rgba(13,20,36,.08),0 1px 3px rgba(13,20,36,.14);
              font-size:11px;line-height:1.25;pointer-events:none;
            "><div style="font-weight:600">${escapeHtml(initialsOf(rider.name))}</div><div style="color:#4d5765">${escapeHtml(detail)}</div></div>
          </div>`
}

const DISC = 30
const DISC_SELECTED = 36

function iconFor(L: typeof import('leaflet'), html: string, size: number) {
  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

function popupHtml(rider: RiderView): string {
  const pos = rider.position!
  return [
    `<strong>${escapeHtml(rider.name)}</strong>`,
    `${statusLabelOf(rider)} · ${ageLabel(pos.recordedAt)}`,
    rider.work.carrying > 0
      ? `Carrying ${rider.work.carrying} order${rider.work.carrying === 1 ? '' : 's'}`
      : 'Carrying nothing',
    speedLabel(pos.speedMetresPerSecond),
    pos.accuracyMetres ? `±${Math.round(pos.accuracyMetres)}m` : null,
  ]
    .filter(Boolean)
    .join('<br/>')
}

/**
 * Riders on a map.
 *
 * Leaflet, driven directly rather than through a React wrapper. The wrapper
 * libraries want to own the map's lifecycle, and this map is re-fed every few
 * seconds from a poll: re-rendering markers as components would fight the pan
 * and zoom the admin has set, which is the one piece of state on this page
 * that belongs to the person rather than the server. So the map is created
 * once and each rider's marker is moved in place on every poll — which also
 * keeps a popup the operator has opened open, where clearing and redrawing
 * would shut it within seconds.
 *
 * The map is only auto-fitted once, on the first load that has anyone to show.
 * After that the view is the operator's — a board that yanked itself back to
 * "fit everyone" every poll would be unusable the moment you zoomed in on the
 * rider you were actually watching.
 *
 * Tiles come from OpenStreetMap's public servers, which need no key and no
 * account. That is the right trade for a handful of admin screens; a paid tile
 * provider is a one-line swap here if this ever grows past that.
 */
export function RiderMap({
  riders,
  selectedId,
  focusRequest,
  onSelect,
}: {
  riders: RiderView[]
  /** The rider picked in the roster or on the map, drawn emphasised. */
  selectedId: string | null
  /** Pan to this rider each time `n` changes — the roster's row click. */
  focusRequest: { id: string; n: number } | null
  /** A marker was clicked. */
  onSelect: (riderId: string) => void
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<LeafletMap | null>(null)
  const markerLayer = useRef<LayerGroup | null>(null)
  const drawn = useRef(new Map<string, Drawn>())
  const fitted = useRef(false)
  const handled = useRef(0)
  // Markers outlive renders, so their click handlers read the latest callback
  // through a ref rather than closing over the first one.
  const select = useRef(onSelect)
  useEffect(() => {
    select.current = onSelect
  }, [onSelect])
  // Bumped once the map exists, so the effects below run again for a poll
  // that landed while Leaflet was still loading.
  const [ready, setReady] = useState(false)

  // Leaflet reaches for `window` at import time, so it cannot be a module-level
  // import in a tree Next also renders on the server.
  useEffect(() => {
    let cancelled = false
    let resize: ResizeObserver | null = null
    const markers = drawn.current

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

      // Leaflet only notices window resizes. Collapsing the sidebar or
      // crossing into the side-by-side layout resizes the map's box without
      // one, and leaves a band of grey where tiles were never asked for.
      resize = new ResizeObserver(() => instance.invalidateSize())
      resize.observe(holder.current)

      setReady(true)
    })()

    return () => {
      cancelled = true
      resize?.disconnect()
      map.current?.remove()
      map.current = null
      markerLayer.current = null
      markers.clear()
    }
  }, [])

  // Bring every marker up to date with the latest poll and selection.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = (await import('leaflet')).default
      const layer = markerLayer.current
      const instance = map.current
      if (cancelled || !layer || !instance) return

      const placed = riders.filter(
        (r) => r.position !== null && r.presence !== 'NEVER',
      )
      const seen = new Set<string>()

      for (const rider of placed) {
        const pos = rider.position!
        const latLng: [number, number] = [pos.lat, pos.lng]
        const tone = STATUS_TONE[boardStatusOf(rider)]
        const selected = rider.id === selectedId
        const html = markerHtml(rider, selected)
        const size = selected ? DISC_SELECTED : DISC
        seen.add(rider.id)

        let entry = drawn.current.get(rider.id)
        if (!entry) {
          // divIcon rather than an image marker: Leaflet's default marker
          // points at PNGs by a relative URL that the bundler rewrites, which
          // is the classic broken-image-pin. Inline markup has no such path.
          const marker = L.marker(latLng, { title: rider.name, icon: iconFor(L, html, size) })
            .on('click', () => select.current(rider.id))
            // No auto-pan: the roster's "show on map" centres the marker
            // itself, and a popup nudging the view afterwards would undo that.
            .bindPopup('', { autoPan: false })
            .addTo(layer)
          entry = { marker, iconHtml: html, trail: null, accuracy: null }
          drawn.current.set(rider.id, entry)
        }

        entry.marker.setLatLng(latLng)
        entry.marker.setPopupContent(popupHtml(rider))
        entry.marker.setZIndexOffset(selected ? 1000 : 0)
        if (entry.iconHtml !== html) {
          entry.marker.setIcon(iconFor(L, html, size))
          entry.iconHtml = html
        }

        // The path walked in the last few minutes, so a still marker and a
        // moving one look different at a glance.
        const trailStyle = {
          color: tone.hex,
          weight: selected ? 4 : 3,
          opacity: rider.presence === 'LIVE' ? 0.55 : 0.3,
        }
        const trail = rider.trail.map((p) => [p.lat, p.lng] as [number, number])
        if (trail.length > 1) {
          if (entry.trail) entry.trail.setLatLngs(trail).setStyle(trailStyle)
          else entry.trail = L.polyline(trail, trailStyle).addTo(layer)
        } else if (entry.trail) {
          entry.trail.remove()
          entry.trail = null
        }

        // The device's own accuracy, drawn rather than hidden: a 400m circle
        // says "this is a tower fix, do not send anyone to this dot".
        if (pos.accuracyMetres && pos.accuracyMetres > 40) {
          const style = { color: tone.hex, fillColor: tone.hex }
          if (entry.accuracy) {
            entry.accuracy.setLatLng(latLng).setRadius(pos.accuracyMetres).setStyle(style)
          } else {
            entry.accuracy = L.circle(latLng, {
              ...style,
              radius: pos.accuracyMetres,
              weight: 1,
              opacity: 0.4,
              fillOpacity: 0.08,
            }).addTo(layer)
          }
        } else if (entry.accuracy) {
          entry.accuracy.remove()
          entry.accuracy = null
        }
      }

      // Riders who left the board — deactivated, or their position cleared.
      for (const [id, entry] of drawn.current) {
        if (seen.has(id)) continue
        entry.marker.remove()
        entry.trail?.remove()
        entry.accuracy?.remove()
        drawn.current.delete(id)
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
  }, [riders, selectedId, ready])

  // Panning to one rider is an explicit request from the roster, so unlike
  // the refresh it is allowed to move the view — once per request, never on
  // the poll that follows it.
  useEffect(() => {
    if (!focusRequest || focusRequest.n === handled.current || !map.current) return
    const target = riders.find((r) => r.id === focusRequest.id)
    if (!target?.position) return
    handled.current = focusRequest.n
    // Popup first, then the move: the map may have been resized since it
    // last looked, and a stale size centres on the wrong pixel.
    drawn.current.get(target.id)?.marker.openPopup()
    map.current.invalidateSize()
    map.current.setView([target.position.lat, target.position.lng], SINGLE_RIDER_ZOOM, {
      animate: true,
    })
  }, [focusRequest, riders, ready])

  return (
    <div
      ref={holder}
      role="application"
      aria-label="Map of rider positions"
      className="h-full w-full bg-sunken"
    />
  )
}
