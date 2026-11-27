/*
 * Joining RailServe as a new company, step by step:
 *
 *   1. Documents: five uploads, each accepted or rejected (with a reason) by
 *      a platform admin. A rejected one is uploaded again.
 *   2. Link Gmail: the mailbox aggregator orders arrive in. Opens once every
 *      document is accepted.
 *   3. Payment: paid by UPI or bank transfer and confirmed by a platform
 *      admin, who can also mark it received on their own.
 *
 * When all three are done the company becomes ACTIVE on its own and the
 * owner gets the full app. Pure rules here; the reads and writes are in
 * repo/onboardingRepo.
 */

export const DOC_KINDS = [
  { kind: 'FSSAI', label: 'FSSAI food licence', hint: 'Your FSSAI licence or registration certificate, showing the business name and licence number.' },
  { kind: 'GST', label: 'GST certificate', hint: 'Your GST registration certificate. If you are not registered for GST, upload a signed letter saying so.' },
  { kind: 'PAN', label: 'PAN card', hint: "The business's PAN card. For a sole owner, the owner's own PAN card." },
  { kind: 'OWNER_ID', label: "Owner's ID proof", hint: 'Aadhaar, voter ID, passport or driving licence. For Aadhaar, use a masked copy: only the last 4 digits showing.' },
  { kind: 'BANK', label: 'Bank proof', hint: 'A cancelled cheque, or the first page of the passbook, in the business name.' },
] as const

export type DocKind = (typeof DOC_KINDS)[number]['kind']
export type DocStatus = 'MISSING' | 'PENDING' | 'ACCEPTED' | 'REJECTED'
export type PaymentStatus = 'DUE' | 'CLAIMED' | 'PAID'

export const isDocKind = (v: string): v is DocKind => DOC_KINDS.some((d) => d.kind === v)
export const docLabel = (kind: string) => DOC_KINDS.find((d) => d.kind === kind)?.label ?? kind

/** Files a company may upload: a photo or a PDF, 5 MB at most. */
export const UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export type OnboardingDoc = { kind: string; status: DocStatus; fileName?: string | null; reason?: string | null; uploadedAt?: Date | null }

/** Every slot, in order, whether or not anything has been uploaded to it yet. */
export function documentSlots(docs: OnboardingDoc[]): (OnboardingDoc & { label: string; hint: string })[] {
  return DOC_KINDS.map((d) => {
    const have = docs.find((x) => x.kind === d.kind)
    return { kind: d.kind, label: d.label, hint: d.hint, status: have?.status ?? 'MISSING', fileName: have?.fileName ?? null, reason: have?.reason ?? null, uploadedAt: have?.uploadedAt ?? null }
  })
}

export type StepState = 'done' | 'todo' | 'waiting' | 'locked'

export type Progress = {
  documents: { state: StepState; accepted: number; pending: number; rejected: number; missing: number }
  gmail: { state: StepState }
  payment: { state: StepState }
  /** Everything done: the company can be let in. */
  ready: boolean
  /** How many of the three steps are done. */
  doneCount: number
}

/**
 * Where an applicant stands. Documents are "waiting" while any sits with us
 * for review and nothing is the applicant's to fix; Gmail stays locked until
 * every document is accepted; payment can be made at any time.
 */
export function progressOf(o: { documents: OnboardingDoc[]; payment: { status: PaymentStatus } }, gmailLinked: boolean): Progress {
  const slots = documentSlots(o.documents)
  const count = (s: DocStatus) => slots.filter((d) => d.status === s).length
  const accepted = count('ACCEPTED')
  const pending = count('PENDING')
  const rejected = count('REJECTED')
  const missing = count('MISSING')
  const docsDone = accepted === slots.length
  const documents: Progress['documents'] = {
    state: docsDone ? 'done' : rejected + missing > 0 ? 'todo' : 'waiting',
    accepted,
    pending,
    rejected,
    missing,
  }
  const gmail: Progress['gmail'] = { state: gmailLinked ? 'done' : docsDone ? 'todo' : 'locked' }
  const payment: Progress['payment'] = { state: o.payment.status === 'PAID' ? 'done' : o.payment.status === 'CLAIMED' ? 'waiting' : 'todo' }
  const ready = docsDone && gmailLinked && o.payment.status === 'PAID'
  return { documents, gmail, payment, ready, doneCount: [docsDone, gmailLinked, o.payment.status === 'PAID'].filter(Boolean).length }
}

/** A handle for the URL and mail address, from the business name: "Bite Station Gaya" → "bite-station-gaya". */
export function slugFrom(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
    .replace(/-+$/g, '')
  return s.length >= 3 ? s : `company-${s || 'new'}`
}

/** The message an applicant gets after a review. Plain, with what to do next. */
export function reviewNotice(company: string, decisions: { kind: string; accepted: boolean; reason?: string | null }[], progress: Progress): { subject: string; body: string } {
  const rejected = decisions.filter((d) => !d.accepted)
  const lines = decisions.map((d) => `• ${docLabel(d.kind)}: ${d.accepted ? 'accepted' : `not accepted. ${d.reason ?? ''}`.trim()}`)
  const next = rejected.length
    ? 'Please sign in to RailServe and upload the documents marked "not accepted" again.'
    : progress.documents.state === 'done'
      ? 'All your documents are accepted. Sign in to RailServe to link your Gmail and finish joining.'
      : 'We will tell you as soon as the rest are reviewed.'
  return {
    subject: rejected.length ? `${company}: some documents need to be uploaded again` : `${company}: documents accepted`,
    body: [`Your documents for ${company} have been reviewed:`, '', ...lines, '', next].join('\n'),
  }
}
