/**
 * WhatsApp bulk-enquiry paste parser. Plan §7.
 *
 * The parse is NEVER authoritative. Every field it produces pre-fills a normal
 * editable input that a human completes — so a bad parse costs nothing, and
 * being clever here would be a mistake. Unrecognised lines are appended to
 * notes rather than dropped, because the pasted text is the record of what was
 * actually asked for when a dispute arises.
 */
export type ParsedEnquiry = {
  serviceDate: string | null
  location: string | null
  trainNo: string | null
  time: string | null
  pax: number | null
  menu: string | null
  notes: string[]
}

/** Alias map from plan §7. */
const KEYS: { field: keyof ParsedEnquiry; aliases: string[] }[] = [
  { field: 'serviceDate', aliases: ['date'] },
  { field: 'location', aliases: ['location', 'station'] },
  { field: 'trainNo', aliases: ['train no', 'train', 'train number'] },
  { field: 'time', aliases: ['time'] },
  { field: 'pax', aliases: ['pax', 'no of pax', 'pax count'] },
  { field: 'menu', aliases: ['menu'] },
]

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/** `03-Sep`, `3 Sep`, `03/09`, `2026-09-03` → 'YYYY-MM-DD' in IST. */
export function parseEnquiryDate(raw: string, now = new Date()): string | null {
  const v = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v

  const currentYear = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(now),
  )

  const named = /^(\d{1,2})[-/\s]([A-Za-z]{3})/.exec(v)
  if (named) {
    const month = MONTHS[named[2].toLowerCase()]
    if (month === undefined) return null
    return isoFor(currentYear, month, Number(named[1]), now)
  }

  const numeric = /^(\d{1,2})[-/](\d{1,2})$/.exec(v)
  if (numeric) {
    return isoFor(currentYear, Number(numeric[2]) - 1, Number(numeric[1]), now)
  }

  return null
}

function isoFor(year: number, month: number, day: number, now: Date): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  let iso = `${year}-${pad(month + 1)}-${pad(day)}`

  // Enquiries are for upcoming service. A date already well past is almost
  // certainly next year's.
  if (new Date(`${iso}T23:59:59+05:30`).getTime() < now.getTime() - 7 * 86_400_000) {
    iso = `${year + 1}-${pad(month + 1)}-${pad(day)}`
  }
  return iso
}

/** `7:30PM`, `19:30`, `7.30 pm` → 'HH:mm' for a time input. */
export function parseEnquiryTime(raw: string): string | null {
  const m = /(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i.exec(raw.trim())
  if (!m) return null

  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  const meridiem = m[3]?.toLowerCase()

  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function parseBulkEnquiry(text: string, now = new Date()): ParsedEnquiry {
  const out: ParsedEnquiry = {
    serviceDate: null, location: null, trainNo: null,
    time: null, pax: null, menu: null, notes: [],
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // A bare header like *Query* carries no data but is not worth keeping.
    if (/^\*?\s*query\s*\*?$/i.test(trimmed)) continue

    // Split on the FIRST = or -, so a menu containing either survives intact.
    const sep = /[=]/.test(trimmed) ? '=' : '-'
    const idx = trimmed.indexOf(sep)
    if (idx < 0) {
      out.notes.push(trimmed)
      continue
    }

    const key = trimmed.slice(0, idx).trim().toLowerCase().replace(/\s+/g, ' ')
    const value = trimmed.slice(idx + 1).trim()

    const match = KEYS.find((k) => k.aliases.includes(key))
    if (!match) {
      out.notes.push(trimmed)
      continue
    }
    // "Train no -" with nothing after it is a field the sender left blank,
    // not a note.
    if (!value) continue

    switch (match.field) {
      case 'serviceDate':
        out.serviceDate = parseEnquiryDate(value, now)
        if (!out.serviceDate) out.notes.push(trimmed)
        break
      case 'time':
        out.time = parseEnquiryTime(value)
        if (!out.time) out.notes.push(trimmed)
        break
      case 'pax': {
        const n = Number(value.replace(/\D/g, ''))
        out.pax = Number.isFinite(n) && n > 0 ? n : null
        if (!out.pax) out.notes.push(trimmed)
        break
      }
      case 'trainNo':
        out.trainNo = /\d/.test(value) ? value.replace(/\D/g, '') : null
        break
      case 'location':
        out.location = value
        break
      case 'menu':
        out.menu = value
        break
    }
  }

  return out
}
