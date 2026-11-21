'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, LayerGroup, Marker, Polyline, Circle } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { RiderView } from '@/lib/repo/riderLocationRepo'
import { ageLabel, speedLabel } from '@/lib/riderLocation'
import { STATUS_HEX, boardStatusOf, statusWordOf } from '@/lib/v2/ridersShared'

/** Where the map opens when no rider has ever reported: roughly central India. */
const FALLBACK_CENTRE: [number, number] = [22.9734, 78.6569]
const FALLBACK_ZOOM = 5
/** Close enough to read a platform, far enough to keep the station in frame. */
const SINGLE_RIDER_ZOOM = 16
const DISC = 30
const DISC_SELECTED = 36

type MapRider = RiderView & { active?: boolean }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()
}

/** What the map keeps per rider between polls, so it is moved rather than redrawn. */
type Drawn = { marker: Marker; iconHtml: string; trail: Polyline | null; accuracy: Circle | null }

/**
 * The marker: a disc in the status colour with initials, and a small tag
 * beside it with status and station, so the map reads without clicking. The
 * selected rider is larger and ringed in the brand green, the same colour as
 * their row.
 */
function markerHtml(rider: MapRider, selected: boolean): string {
  const hex = STATUS_HEX[boardStatusOf(rider)]
  const disc = selected ? DISC_SELECTED : DISC
  const halo = selected ? '0 0 0 3px #fff,0 0 0 5px #1f6b47,0 2px 6px rgba(17,26,21,.35)' : `0 0 0 4px ${hex}33,0 1px 3px rgba(17,26,21,.35)`
  const detail = [statusWordOf(rider), rider.work.stations[0]].filter(Boolean).join(' · ')
  return `<div style="position:relative;width:${disc}px;height:${disc}px;font-family:var(--font-v2)">
    <div style="display:flex;align-items:center;justify-content:center;width:${disc}px;height:${disc}px;border-radius:9999px;background:${hex};color:#fff;font-weight:700;font-size:${selected ? 12 : 11}px;line-height:1;border:2px solid #fff;box-shadow:${halo}">${escapeHtml(initialsOf(rider.name))}</div>
    <div style="position:absolute;left:${disc + 6}px;top:50%;transform:translateY(-50%);white-space:nowrap;padding:3px 7px;border-radius:8px;background:rgba(255,255,255,.96);color:#111a15;box-shadow:0 0 0 1px rgba(17,26,21,.08),0 1px 3px rgba(17,26,21,.14);font-size:11px;line-height:1.25;pointer-events:none"><div style="font-weight:700">${escapeHtml(rider.name.split(/\s+/)[0] ?? '')}</div><div style="color:#66716b">${escapeHtml(detail)}</div></div>
  </div>`
}

function iconFor(L: typeof import('leaflet'), html: string, size: number) {
  return L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] })
}

function popupHtml(rider: MapRider): string {
  const pos = rider.position!
  return [
    `<strong>${escapeHtml(rider.name)}</strong>`,
    `${statusWordOf(rider)} · ${ageLabel(pos.recordedAt)}`,
    rider.work.carrying > 0 ? `Carrying ${rider.work.carrying} bag${rider.work.carrying === 1 ? '' : 's'}` : 'Carrying nothing',
    speedLabel(pos.speedMetresPerSecond),
    pos.accuracyMetres ? `±${Math.round(pos.accuracyMetres)}m` : null,
  ]
    .filter(Boolean)
    .join('<br/>')
}

/**
 * Riders on a Leaflet map, driven directly rather than through a wrapper:
 * the board re-feeds it every few seconds, and re-rendering markers as
 * components would fight the pan and zoom the operator has set. The map is
 * created once, each marker is moved in place, and the view is auto-fitted
 * only on the first load that has anyone to show.
 *
 * Tiles are OpenStreetMap's public servers: no key, no account.
 */
export function RiderMap({
  riders,
  selectedId,
  focusRequest,
  onSelect,
}: {
  riders: MapRider[]
  selectedId: string | null
  /** Pan to this rider each time `n` changes. */
  focusRequest: { id: string; n: number } | null
  onSelect: (riderId: string) => void
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<LeafletMap | null>(null)
  const markerLayer = useRef<LayerGroup | null>(null)
  const drawn = useRef(new Map<string, Drawn>())
  const fitted = useRef(false)
  const handled = useRef(0)
  // Markers outlive renders; their click handlers read the latest callback.
  const select = useRef(onSelect)
  useEffect(() => {
    select.current = onSelect
  }, [onSelect])
  const [ready, setReady] = useState(false)

  // Leaflet reaches for `window` at import time, so it is loaded here, never
  // at module level.
  useEffect(() => {
    let cancelled = false
    let resize: ResizeObserver | null = null
    const markers = drawn.current

    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !holder.current || map.current) return
      const instance = L.map(holder.current, { center: FALLBACK_CENTRE, zoom: FALLBACK_ZOOM, scrollWheelZoom: false })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(instance)
      markerLayer.current = L.layerGroup().addTo(instance)
      map.current = instance
      // Leaflet only notices window resizes; the card resizes without one.
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import('leaflet')).default
      const layer = markerLayer.current
      const instance = map.current
      if (cancelled || !layer || !instance) return

      const placed = riders.filter((r) => r.position !== null && r.presence !== 'NEVER')
      const seen = new Set<string>()

      for (const rider of placed) {
        const pos = rider.position!
        const latLng: [number, number] = [pos.lat, pos.lng]
        const hex = STATUS_HEX[boardStatusOf(rider)]
        const selected = rider.id === selectedId
        const html = markerHtml(rider, selected)
        const size = selected ? DISC_SELECTED : DISC
        seen.add(rider.id)

        let entry = drawn.current.get(rider.id)
        if (!entry) {
          const marker = L.marker(latLng, { title: rider.name, icon: iconFor(L, html, size) })
            .on('click', () => select.current(rider.id))
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

        const trailStyle = { color: hex, weight: selected ? 4 : 3, opacity: rider.presence === 'LIVE' ? 0.55 : 0.3 }
        const trail = rider.trail.map((p) => [p.lat, p.lng] as [number, number])
        if (trail.length > 1) {
          if (entry.trail) entry.trail.setLatLngs(trail).setStyle(trailStyle)
          else entry.trail = L.polyline(trail, trailStyle).addTo(layer)
        } else if (entry.trail) {
          entry.trail.remove()
          entry.trail = null
        }

        // A 400m circle says "tower fix, do not send anyone to this dot".
        if (pos.accuracyMetres && pos.accuracyMetres > 40) {
          const style = { color: hex, fillColor: hex }
          if (entry.accuracy) entry.accuracy.setLatLng(latLng).setRadius(pos.accuracyMetres).setStyle(style)
          else entry.accuracy = L.circle(latLng, { ...style, radius: pos.accuracyMetres, weight: 1, opacity: 0.4, fillOpacity: 0.08 }).addTo(layer)
        } else if (entry.accuracy) {
          entry.accuracy.remove()
          entry.accuracy = null
        }
      }

      for (const [id, entry] of drawn.current) {
        if (seen.has(id)) continue
        entry.marker.remove()
        entry.trail?.remove()
        entry.accuracy?.remove()
        drawn.current.delete(id)
      }

      if (!fitted.current && placed.length > 0) {
        fitted.current = true
        if (placed.length === 1) instance.setView([placed[0].position!.lat, placed[0].position!.lng], SINGLE_RIDER_ZOOM)
        else instance.fitBounds(placed.map((r) => [r.position!.lat, r.position!.lng] as [number, number]), { padding: [40, 40], maxZoom: SINGLE_RIDER_ZOOM })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [riders, selectedId, ready])

  // An explicit "show on map" may move the view, once per request.
  useEffect(() => {
    if (!focusRequest || focusRequest.n === handled.current || !map.current) return
    const target = riders.find((r) => r.id === focusRequest.id)
    if (!target?.position) return
    handled.current = focusRequest.n
    drawn.current.get(target.id)?.marker.openPopup()
    map.current.invalidateSize()
    map.current.setView([target.position.lat, target.position.lng], SINGLE_RIDER_ZOOM, { animate: true })
  }, [focusRequest, riders, ready])

  return <div ref={holder} role="application" aria-label="Map of rider positions" className="h-full w-full bg-v2-sunken" />
}
