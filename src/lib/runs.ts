/**
 * A run is the unit of dispatch. Plan §9: "The unit of dispatch is a train run,
 * not an order" — all orders for the same train, on the same day, at the same
 * station go to the platform together in one walk.
 *
 * Pure functions only: no database, so this is testable and usable on both
 * sides of the server/client boundary.
 */

export const NO_TRAIN = 'NOTRAIN'

/** `~` is URL-unreserved and cannot appear in a train no, ISO date or station code. */
const SEP = '~'

/** Strict identity, as produced by parseRunKey. */
export type RunIdentity = {
  trainNo: string | null
  serviceDate: string
  stationCode: string
}

/**
 * Loose input side. Lean Mongoose docs type optional fields as
 * `string | null | undefined`, and a run key should not need them narrowed
 * at every call site.
 */
export type RunKeyInput = {
  trainNo?: string | null
  serviceDate: string
  stationCode: string
}

export function runKeyFor(o: RunKeyInput): string {
  return [o.trainNo || NO_TRAIN, o.serviceDate, o.stationCode].join(SEP)
}

export function parseRunKey(key: string): RunIdentity | null {
  const parts = key.split(SEP)
  if (parts.length !== 3) return null
  const [trainNo, serviceDate, stationCode] = parts
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return null
  if (!stationCode) return null
  return {
    trainNo: trainNo === NO_TRAIN ? null : trainNo,
    serviceDate,
    stationCode,
  }
}

/**
 * Orders a run by coach so the agent walks the platform in one direction
 * rather than doubling back — a halt at a station like Kanpur Central may be
 * five minutes (plan §9).
 *
 * This is a natural sort on the coach label (letter group, then number), not
 * true physical rake order, which varies per train and is not data we hold.
 * It at least keeps a class together and its numbers ascending, which is most
 * of the benefit.
 */
export function compareCoach(a: string | null, b: string | null): number {
  // A bulk handover has no coach; it goes last so it does not interrupt the walk.
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1

  const parse = (c: string) => {
    const m = /^([A-Za-z]*)(\d*)/.exec(c.trim().toUpperCase())
    return { alpha: m?.[1] ?? '', num: m?.[2] ? Number(m[2]) : 0 }
  }
  const pa = parse(a)
  const pb = parse(b)

  if (pa.alpha !== pb.alpha) return pa.alpha.localeCompare(pb.alpha)
  return pa.num - pb.num
}

export type RunOrder = RunKeyInput & {
  _id: unknown
  coach?: string | null
  status: string
  scheduledArrival?: Date | null
  trainName?: string | null
}

export type Run<T extends RunOrder> = {
  key: string
  trainNo: string | null
  trainName: string | null
  serviceDate: string
  stationCode: string
  scheduledArrival: Date | null
  orders: T[]
  statusCounts: Record<string, number>
}

/** Groups orders into runs, each internally sorted by coach. */
export function groupIntoRuns<T extends RunOrder>(orders: T[]): Run<T>[] {
  const byKey = new Map<string, T[]>()
  for (const o of orders) {
    const key = runKeyFor(o)
    const list = byKey.get(key)
    if (list) list.push(o)
    else byKey.set(key, [o])
  }

  const runs: Run<T>[] = []
  for (const [key, list] of byKey) {
    list.sort((a, b) => compareCoach(a.coach ?? null, b.coach ?? null))

    const statusCounts: Record<string, number> = {}
    for (const o of list) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1

    // Every order on a run shares a scheduled arrival in practice; take the
    // earliest so a stray null or a late edit cannot push the whole run out.
    const arrivals = list
      .map((o) => o.scheduledArrival)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime())

    runs.push({
      key,
      trainNo: list[0].trainNo ?? null,
      trainName: list.find((o) => o.trainName)?.trainName ?? null,
      serviceDate: list[0].serviceDate,
      stationCode: list[0].stationCode,
      scheduledArrival: arrivals[0] ?? null,
      orders: list,
      statusCounts,
    })
  }

  // Soonest arrival first; runs with no time known sink to the bottom.
  runs.sort((a, b) => {
    if (!a.scheduledArrival && !b.scheduledArrival) return 0
    if (!a.scheduledArrival) return 1
    if (!b.scheduledArrival) return -1
    return a.scheduledArrival.getTime() - b.scheduledArrival.getTime()
  })

  return runs
}
