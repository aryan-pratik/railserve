/**
 * Timezone and money conventions from plan §2.
 *
 * All timestamps are stored UTC and displayed Asia/Kolkata. `serviceDate` is a
 * plain 'YYYY-MM-DD' string in IST, never a Date — a date-only value stored as
 * a Date lands on the previous day for anyone east of UTC.
 *
 * India has no DST, so the +05:30 offset is a constant and can be used
 * directly rather than pulled from a timezone database at write time.
 */

const IST_OFFSET = '+05:30'

/** Today in IST as 'YYYY-MM-DD'. en-CA formats as ISO, which is why it's used here. */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

/** Shifts an IST service date by n days, staying in 'YYYY-MM-DD'. */
export function shiftServiceDate(serviceDate: string, days: number): string {
  const d = new Date(`${serviceDate}T00:00:00${IST_OFFSET}`)
  d.setUTCDate(d.getUTCDate() + days)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

/**
 * Converts a <input type="datetime-local"> value ("2026-08-27T13:25"), which
 * the browser gives us with no zone, into a UTC Date read as IST wall time.
 */
export function istLocalToUtc(local: string): Date | null {
  if (!local) return null
  const withSeconds = local.length === 16 ? `${local}:00` : local
  const d = new Date(`${withSeconds}${IST_OFFSET}`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Inverse of istLocalToUtc, for pre-filling a datetime-local input. */
export function utcToIstLocal(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** e.g. "27 Aug, 1:25 pm" */
export function formatIST(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

/** e.g. "1:25 pm" */
export function formatTimeIST(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

/** e.g. "Thu 27 Aug 2026" */
export function formatServiceDate(serviceDate: string): string {
  const d = new Date(`${serviceDate}T12:00:00${IST_OFFSET}`)
  if (Number.isNaN(d.getTime())) return serviceDate
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(d)
}

// --- money -------------------------------------------------------------
// Stored in paise as an integer. Never a float, never Decimal128.

export function rupeesToPaise(rupees: string | number | null | undefined): number | null {
  if (rupees === null || rupees === undefined || rupees === '') return null
  const n = typeof rupees === 'string' ? Number(rupees.replace(/,/g, '')) : rupees
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function paiseToRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return ''
  return (paise / 100).toFixed(2)
}

/** e.g. "₹236.00" */
export function formatMoney(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 2,
  }).format(paise / 100)
}
