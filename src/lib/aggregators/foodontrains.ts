import type mongoose from 'mongoose'
import { env } from '../env'
import { Restaurant } from '../models'

/**
 * Reports a FoodOnTrains order's status back to FoodOnTrains.
 *
 * Their API takes four statuses, and only the steps a passenger would care
 * about map to one. Ready, KOT printed and every support outcome are kitchen
 * business and send nothing — including FAILED ("not delivered"), which
 * FoodOnTrains has no word for.
 *
 * Runs after the status change has committed and never blocks it: the panel
 * must not wait on, or break because of, a partner's API. On this
 * self-hosted Node server a detached promise simply runs to completion, so
 * it does not need next/server's after(), which would also tie it to a
 * request scope that tests and scripts do not have.
 *
 * FoodOnTrains issues one key per outlet, and each key can update only that
 * outlet's orders, so the key lives on our outlet the order was routed to
 * (Restaurant.foodOnTrainsApiKey) — Zaika at CNB and Zaika at GAYA each hold
 * their own. An outlet with no key sends nothing, which is also what keeps
 * dev and the test suite off their API.
 *
 * Calls for one order run one after another. Accepting and dispatching in
 * quick succession would otherwise race, and a "confirmed" landing after
 * "out_for_delivery" is a 409 that loses nothing but reads as an error.
 */
export type FoodOnTrainsStatus = 'confirmed' | 'out_for_delivery' | 'delivered' | 'cancelled'

const STATUS_FOR: Partial<Record<string, FoodOnTrainsStatus>> = {
  ACCEPTED: 'confirmed',
  DISPATCHED: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
}

/** Waits before each retry of a network error or a 5xx. */
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000]
const ATTEMPT_TIMEOUT_MS = 10_000

/** Keyed on the id, not the source, as FoodOnTrains asks: an FT- id is theirs however it was entered. */
export function foodOnTrainsStatusFor(order: {
  externalOrderId?: string | null
  status: string
}): FoodOnTrainsStatus | null {
  if (!order.externalOrderId?.startsWith('FT-')) return null
  return STATUS_FOR[order.status] ?? null
}

export type PushResult =
  | { ok: true; httpStatus: number }
  | { ok: false; httpStatus: number | null; detail: string }

export async function pushFoodOnTrainsStatus(
  orderId: string,
  status: FoodOnTrainsStatus,
  deps: {
    apiUrl: string
    apiKey: string
    fetch?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    retryDelaysMs?: readonly number[]
  },
): Promise<PushResult> {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS
  const url = `${deps.apiUrl.replace(/\/+$/, '')}/restaurant/orders/${encodeURIComponent(orderId)}/status`

  let last: PushResult = { ok: false, httpStatus: null, detail: 'not attempted' }
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1])
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      })
      if (res.ok) return { ok: true, httpStatus: res.status }
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      last = { ok: false, httpStatus: res.status, detail }
      // 401, 404, and 409 (already closed, or the status would go backwards)
      // are answers, not outages: retrying cannot change them.
      if (res.status < 500) return last
    } catch (err) {
      last = { ok: false, httpStatus: null, detail: err instanceof Error ? err.message : String(err) }
    }
  }
  return last
}

/** The FoodOnTrains key saved on one of our outlets, or null when it has none. */
export async function foodOnTrainsKeyFor(
  restaurantId: mongoose.Types.ObjectId | string | null | undefined,
): Promise<string | null> {
  if (!restaurantId) return null
  const outlet = await Restaurant.findById(restaurantId).select('+foodOnTrainsApiKey').lean()
  return outlet?.foodOnTrainsApiKey?.trim() || null
}

const chains = new Map<string, Promise<void>>()

/**
 * Fire-and-forget. Call with the order as it stands after the change has
 * committed; returns at once and never throws.
 */
export function reportFoodOnTrainsStatus(order: {
  externalOrderId?: string | null
  restaurantId?: mongoose.Types.ObjectId | string | null
  status: string
}): void {
  try {
    const status = foodOnTrainsStatusFor(order)
    if (!status) return
    const orderId = order.externalOrderId!

    const next = (chains.get(orderId) ?? Promise.resolve())
      .then(async () => {
        const apiKey = await foodOnTrainsKeyFor(order.restaurantId)
        if (!apiKey) return null
        return pushFoodOnTrainsStatus(orderId, status, { apiUrl: env.FOODONTRAINS_API_URL, apiKey })
      })
      .then((r) => {
        if (!r) {
          console.warn(`[foodontrains] ${orderId} -> ${status} not sent: its outlet has no FoodOnTrains key`)
        } else if (r.ok) {
          console.info(`[foodontrains] ${orderId} -> ${status}`)
        } else {
          console.error(
            `[foodontrains] ${orderId} -> ${status} failed (${r.httpStatus ?? 'network'}): ${r.detail}`,
          )
        }
      })
      .catch((err) => console.error(`[foodontrains] ${orderId} -> ${status} threw`, err))
      .finally(() => {
        if (chains.get(orderId) === next) chains.delete(orderId)
      })
    chains.set(orderId, next)
  } catch (err) {
    console.error('[foodontrains] status report not started', err)
  }
}
