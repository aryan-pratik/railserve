'use server'

import { requireRole } from '@/lib/session'
import { lookupTrainDetail } from '@/lib/train/service'
import { isSimulatedProvider } from '@/lib/train'
import { TrainStatusUnavailable } from '@/lib/train/provider'
import { todayIST } from '@/lib/format'

/**
 * Everything the client renders, already serialised.
 *
 * Dates do not survive the server-action boundary as Dates, and a lookup that
 * silently hands back a string typed as a Date is the kind of thing that only
 * breaks in production.
 */
export type TrainLookup = {
  trainNo: string
  trainName: string | null
  stationCode: string
  stationName: string | null
  serviceDate: string
  scheduledArrivalIso: string | null
  etaAtIso: string | null
  delayMinutes: number | null
  platform: string | null
  currentStationCode: string | null
  currentStationName: string | null
  statusNote: string | null
  providerUpdatedAtIso: string | null
  stopsAway: number | null
  distanceKm: number | null
  provider: string
  simulated: boolean
}

export type LookupState = { error?: string; result?: TrainLookup }

/**
 * Ask the provider about one train at one station, on demand.
 *
 * Routed through lookupTrainDetail rather than the provider directly: the
 * answer lands in the same cache row the board and the polling tick read, so
 * an admin checking on a train also warms it for every order riding that
 * train, and the call is not spent twice. It also means a lookup shows exactly
 * what the rest of the app would show, rather than a second opinion.
 */
export async function lookupTrain(
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  await requireRole('ADMIN')

  const trainNo = String(formData.get('trainNo') ?? '').trim()
  const stationCode = String(formData.get('stationCode') ?? '').trim().toUpperCase()
  const serviceDate = String(formData.get('serviceDate') ?? '').trim() || todayIST()

  if (!/^\d{4,5}$/.test(trainNo)) {
    return { error: 'Enter a train number — 4 or 5 digits, e.g. 12561.' }
  }
  if (!/^[A-Z]{2,5}$/.test(stationCode)) {
    return { error: 'Enter a station code, e.g. CNB for Kanpur Central.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return { error: 'Pick a date.' }
  }

  try {
    const d = await lookupTrainDetail({ trainNo, serviceDate, stationCode })
    return {
      result: {
        trainNo: d.trainNo,
        trainName: d.trainName,
        stationCode: d.stationCode,
        stationName: d.stationName,
        serviceDate,
        scheduledArrivalIso: d.scheduledArrival?.toISOString() ?? null,
        etaAtIso: d.etaAt?.toISOString() ?? null,
        delayMinutes: d.delayMinutes,
        platform: d.platform,
        currentStationCode: d.currentStationCode,
        currentStationName: d.currentStationName,
        statusNote: d.statusNote,
        providerUpdatedAtIso: d.providerUpdatedAt?.toISOString() ?? null,
        stopsAway: d.stopsAway,
        distanceKm: d.distanceKm,
        provider: 'live',
        simulated: isSimulatedProvider(),
      },
    }
  } catch (err) {
    // The provider's own words: "does not stop at CNB", "quota exhausted",
    // "rejected the key". Each is something a person can act on, and a generic
    // "lookup failed" would throw all of that away.
    if (err instanceof TrainStatusUnavailable) return { error: err.message }
    return { error: err instanceof Error ? err.message : 'Lookup failed.' }
  }
}
