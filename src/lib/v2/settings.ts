import mongoose from 'mongoose'
import { env } from '@/lib/env'
import { connectDb } from '@/lib/db'
import { GMAIL_STATE_ID, IngestState, Listing, Restaurant, Station, User } from '@/lib/models'
import { countOrders, countOrdersForOutlet } from '@/lib/repo/orderRepo'
import { isGmailConfigured } from '@/lib/ingest/gmail/client'
import { checkIngestStaleness } from '@/lib/ingest/gmail/sync'
import { isWhatsAppSimulated } from '@/lib/whatsapp'
import { isSimulatedProvider } from '@/lib/train'
import { trainFeedHealth } from '@/lib/train/service'
import { ROLES, type Role } from '@/lib/roles'
import type { AuthContext } from '@/lib/authContext'
import { getPrimaryTenantId, naturalKey, tenantKey } from '@/lib/tenancy/primary'

/*
 * Reads behind /v2/settings. Everything here is plain data for the server
 * page: no Dates cross to client components, and no secret leaves the env
 * (only "set or not", provider names and a masked number).
 */

export type OutletRow = {
  id: string
  name: string
  stationCode: string
  stationName: string | null
  aliases: string[]
  contactName: string | null
  contactPhone: string | null
  walkToPlatformMinutes: number
  active: boolean
}

export type ListingRow = {
  id: string
  name: string
  aliases: string[]
  source: string | null
  stationCode: string
  restaurantId: string | null
  active: boolean
}

export type StationRow = {
  code: string
  name: string | null
  /** False when we only know the station from an outlet, with no Station row yet. */
  configured: boolean
  active: boolean
  defaultRestaurantId: string | null
  hasAgentToken: boolean
  agentLastSeenIso: string | null
  agentLastPrintedIso: string | null
  directPrinterHost: string | null
  directPrinterPort: number | null
}

export type Feed = { name: string; source: string | null; viaDefault: boolean }

export async function loadSetupBase(ctx: AuthContext) {
  await connectDb()
  const tenantId = ctx.tenantId
  const [outletDocs, listingDocs, stationDocs] = await Promise.all([
    Restaurant.find({ tenantId }).sort({ active: -1, name: 1 }).lean(),
    Listing.find({ tenantId }).sort({ stationCode: 1, name: 1 }).lean(),
    Station.find({ tenantId }).lean(),
  ])

  const outlets: OutletRow[] = outletDocs.map((o) => ({
    id: String(o._id),
    name: o.name,
    stationCode: o.stationCode.toUpperCase(),
    stationName: o.stationName ?? null,
    aliases: o.aliases ?? [],
    contactName: o.contactName ?? null,
    contactPhone: o.contactPhone ?? null,
    walkToPlatformMinutes: o.walkToPlatformMinutes ?? 10,
    active: o.active !== false,
  }))

  const listings: ListingRow[] = listingDocs.map((l) => ({
    id: String(l._id),
    name: l.name,
    aliases: l.aliases ?? [],
    source: l.source ?? null,
    stationCode: l.stationCode.toUpperCase(),
    restaurantId: l.restaurantId ? String(l.restaurantId) : null,
    active: l.active !== false,
  }))

  // A station we serve is one with a Station row OR one an outlet names:
  // the row is created lazily (first print token, first default), so a new
  // station shows up here before anyone has configured it.
  const byCode = new Map<string, StationRow>()
  for (const s of stationDocs) {
    // The station code, without the tenant prefix a non-primary tenant's _id carries.
    const code = naturalKey(s._id).toUpperCase()
    byCode.set(code, {
      code,
      name: s.name ?? null,
      configured: true,
      active: s.active !== false,
      defaultRestaurantId: s.defaultRestaurantId ? String(s.defaultRestaurantId) : null,
      hasAgentToken: Boolean(s.printAgentToken),
      agentLastSeenIso: s.agentLastSeenAt?.toISOString() ?? null,
      agentLastPrintedIso: s.agentLastPrintedAt?.toISOString() ?? null,
      directPrinterHost: s.directPrinterHost ?? null,
      directPrinterPort: s.directPrinterHost ? (s.directPrinterPort ?? 9100) : null,
    })
  }
  for (const o of outlets) {
    const existing = byCode.get(o.stationCode)
    if (existing) {
      if (!existing.name && o.stationName) existing.name = o.stationName
      continue
    }
    byCode.set(o.stationCode, {
      code: o.stationCode,
      name: o.stationName,
      configured: false,
      active: true,
      defaultRestaurantId: null,
      hasAgentToken: false,
      agentLastSeenIso: null,
      agentLastPrintedIso: null,
      directPrinterHost: null,
      directPrinterPort: null,
    })
  }
  const stations = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))

  return { outlets, listings, stations }
}

/**
 * The Outlets tab lists kitchens only. A storefront retired by the listings
 * migration is still a `restaurants` row; showing it invites re-activating an
 * aggregator name as an outlet, which then steals that aggregator's orders
 * from the real kitchen. Same filter as v1 setup.
 */
export function kitchensOnly(outlets: OutletRow[], listings: ListingRow[]): OutletRow[] {
  const storefront = new Set(listings.map((l) => `${l.name.trim().toUpperCase()}@${l.stationCode}`))
  return outlets.filter((o) => !storefront.has(`${o.name.trim().toUpperCase()}@${o.stationCode}`))
}

/** What feeds each kitchen: storefronts mapped to it, plus unmapped ones its station sends here by default. */
export function feedsByOutlet(listings: ListingRow[], stations: StationRow[]): Map<string, Feed[]> {
  const defaultOf = new Map(stations.map((s) => [s.code, s.defaultRestaurantId]))
  const out = new Map<string, Feed[]>()
  for (const l of listings) {
    if (!l.active) continue
    const target = l.restaurantId ?? defaultOf.get(l.stationCode) ?? null
    if (!target) continue
    const list = out.get(target) ?? []
    list.push({ name: l.name, source: l.source, viaDefault: !l.restaurantId })
    out.set(target, list)
  }
  return out
}

export async function orderCountsForOutlets(ctx: AuthContext, ids: string[]): Promise<Map<string, number>> {
  const counts = await Promise.all(ids.map((id) => countOrdersForOutlet(ctx, id)))
  return new Map(ids.map((id, i) => [id, counts[i]]))
}

/**
 * What a storefront brought in: its aggregator's orders at the kitchen it
 * points to. Approximate by design: the order records the aggregator, not the
 * storefront name it arrived under.
 */
export async function orderCountsForListings(ctx: AuthContext, listings: ListingRow[]): Promise<Map<string, number>> {
  const counts = await Promise.all(
    listings.map((l) =>
      l.restaurantId && l.source
        ? countOrders(ctx, { restaurantId: new mongoose.Types.ObjectId(l.restaurantId), source: l.source as never })
        : Promise.resolve(0),
    ),
  )
  return new Map(listings.map((l, i) => [l.id, counts[i]]))
}

export type StaffRow = {
  id: string
  name: string
  phone: string
  role: Role
  restaurantIds: string[]
  active: boolean
  canCollectReturns: boolean
  /** Pages an admin switched off for this person (lib/pageAccess.ts). */
  hiddenPages: string[]
  isTeamLead: boolean
  teamLeadId: string | null
  canReceiveCash: boolean | null
}

export type StaffFilter = { q?: string; role?: string }

export function isRole(v: string | undefined): v is Role {
  return Boolean(v) && (ROLES as readonly string[]).includes(v as string)
}

export async function loadStaff(ctx: AuthContext, filter: StaffFilter, paging: { skip: number; limit: number }) {
  await connectDb()
  const where: Record<string, unknown> = { tenantId: ctx.tenantId }
  if (isRole(filter.role)) where.role = filter.role
  const q = filter.q?.trim()
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    where.$or = [{ name: rx }, { phone: rx }]
  }
  const [docs, total, leads] = await Promise.all([
    User.find(where).sort({ active: -1, role: 1, name: 1 }).skip(paging.skip).limit(paging.limit).lean(),
    User.countDocuments(where),
    User.find({ tenantId: ctx.tenantId, role: 'DELIVERY_AGENT', isTeamLead: true }).select('name active').sort({ name: 1 }).lean(),
  ])
  const rows: StaffRow[] = docs.map((u) => ({
    id: String(u._id),
    name: u.name,
    phone: u.phone,
    role: u.role as Role,
    restaurantIds: (u.restaurantIds ?? []).map(String),
    active: u.active !== false,
    canCollectReturns: u.canCollectReturns === true,
    hiddenPages: (u.hiddenPages ?? []).map(String),
    isTeamLead: u.isTeamLead === true,
    teamLeadId: u.teamLeadId ? String(u.teamLeadId) : null,
    canReceiveCash: u.canReceiveCash ?? null,
  }))
  return {
    rows,
    total,
    leads: leads.map((l) => ({ id: String(l._id), name: l.name, active: l.active !== false })),
  }
}

export async function countStaff(ctx: AuthContext): Promise<number> {
  await connectDb()
  return User.countDocuments({ tenantId: ctx.tenantId, active: true })
}

export async function loadAllowedSenders(ctx: AuthContext): Promise<string[]> {
  await connectDb()
  const state = await IngestState.findOne({ _id: await tenantKey(ctx.tenantId, GMAIL_STATE_ID), tenantId: ctx.tenantId })
    .select('allowedSenders')
    .lean()
  return [...(state?.allowedSenders ?? [])].sort()
}

/* ── integrations ─────────────────────────────────────────────────────── */

export type IntegrationStatus = {
  gmail: {
    configured: boolean
    /** The mailbox address when the env names one; Gmail's "me" alias says nothing useful. */
    address: string | null
    watchExpiresIso: string | null
    lastRenewalIso: string | null
    lastMessageIso: string | null
    lastError: string | null
    stale: boolean
    staleMessage: string | null
  }
  whatsapp: { provider: 'simulator' | 'msg91'; simulated: boolean; numberMasked: string | null; openerTemplate: string | null }
  train: {
    provider: string
    simulated: boolean
    failing: boolean
    message: string | null
    failingTrains: string[]
    trainsTried: number
  }
  storage: { configured: boolean; bucket: string | null }
}

export async function loadIntegrations(ctx: AuthContext, now = new Date()): Promise<IntegrationStatus> {
  await connectDb()
  // The caller's own mailbox state. Only the primary tenant has one today (the
  // Gmail mailbox is configured by env); any other tenant reads none.
  const [state, staleness, feed] = await Promise.all([
    IngestState.findOne({ _id: await tenantKey(ctx.tenantId, GMAIL_STATE_ID), tenantId: ctx.tenantId }).lean(),
    checkIngestStaleness(now, ctx.tenantId),
    trainFeedHealth(),
  ])
  // The env-configured mailbox and WhatsApp number belong to the primary
  // tenant; any other company has neither connected yet.
  const primary = (await getPrimaryTenantId()).equals(ctx.tenantId)
  const gmailOn = primary && isGmailConfigured()
  const waSimulated = !primary || isWhatsAppSimulated()
  return {
    gmail: {
      configured: gmailOn,
      address: gmailOn && env.GMAIL_USER_ID && env.GMAIL_USER_ID !== 'me' ? env.GMAIL_USER_ID : null,
      watchExpiresIso: state?.watchExpiresAt?.toISOString() ?? null,
      lastRenewalIso: state?.lastWatchRenewalAt?.toISOString() ?? null,
      lastMessageIso: state?.lastMessageAt?.toISOString() ?? null,
      lastError: state?.lastError ?? null,
      stale: staleness.stale,
      staleMessage: staleness.message,
    },
    whatsapp: {
      provider: waSimulated ? 'simulator' : 'msg91',
      simulated: waSimulated,
      numberMasked: primary && env.MSG91_WHATSAPP_NUMBER ? maskDigits(env.MSG91_WHATSAPP_NUMBER) : null,
      openerTemplate: env.MSG91_OPENER_TEMPLATE || null,
    },
    train: {
      provider: isSimulatedProvider() ? 'simulator' : env.TRAIN_API_PROVIDER,
      simulated: isSimulatedProvider(),
      failing: feed.failing,
      message: feed.message,
      failingTrains: feed.failingTrains,
      trainsTried: feed.trainsTried,
    },
    storage: { configured: Boolean(env.R2_BUCKET && env.R2_ACCESS_KEY_ID), bucket: env.R2_BUCKET || null },
  }
}

/** "9198••••••45": enough to recognise the number, not enough to dial it. */
export function maskDigits(value: string): string {
  const d = value.replace(/\D/g, '')
  if (d.length <= 4) return '•'.repeat(d.length)
  return `${d.slice(0, 2)}${'•'.repeat(Math.max(2, d.length - 4))}${d.slice(-2)}`
}

/* ── presence ─────────────────────────────────────────────────────────── */

/** The agent long-polls every 20 s; three minutes of silence is "offline". */
export const AGENT_ONLINE_WINDOW_MS = 3 * 60_000

export function agentPresence(lastSeenIso: string | null, nowMs: number): { online: boolean; label: string } {
  if (!lastSeenIso) return { online: false, label: 'never called in' }
  const ageMs = nowMs - new Date(lastSeenIso).getTime()
  if (ageMs <= AGENT_ONLINE_WINDOW_MS) return { online: true, label: `online · ${relativeAgo(ageMs)}` }
  return { online: false, label: `offline · last seen ${relativeAgo(ageMs)}` }
}

/** "just now", "2 min ago", "3 h ago", "4 d ago". */
export function relativeAgo(ageMs: number): string {
  const mins = Math.max(0, Math.round(ageMs / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

/** "in 5 h", "in 3 d", or "expired 2 h ago". */
export function relativeUntil(targetIso: string, nowMs: number): string {
  const diff = new Date(targetIso).getTime() - nowMs
  if (diff <= 0) return `expired ${relativeAgo(-diff)}`
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `in ${hours} h`
  return `in ${Math.floor(hours / 24)} d`
}
