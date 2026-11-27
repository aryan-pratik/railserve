import bcrypt from 'bcryptjs'
import mongoose, { Types } from 'mongoose'
import { connectDb } from '../db'
import { ensureIndexes } from '../indexes'
import { Tenant, TenantFile, User } from '../models'
import { tenantGuardMode } from '../tenancy/plugin'
import { forgetPrimaryTenant } from '../tenancy/primary'
import {
  DOC_KINDS, MAX_UPLOAD_BYTES, UPLOAD_TYPES, docLabel, isDocKind, progressOf, reviewNotice, slugFrom,
  type DocStatus, type OnboardingDoc, type PaymentStatus, type Progress,
} from '../onboarding'
import { isGmailLinked, startReadingOnApproval, unlinkMailbox } from './mailboxRepo'
import { isMailerConfigured, sendMail } from '../mailer'

/*
 * A company joining on its own: signing up, its documents, payment, and the
 * platform admin's review. The Tenant model is platform-owned (no guard);
 * TenantFile is tenant-scoped and every read here names the tenant.
 *
 * Callers check who is asking: the applicant's own pages use requireApplicant
 * (lib/session), the review pages requirePlatformAdmin.
 */

export class OnboardingError extends Error {}

const PHONE = /^[6-9]\d{9}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type SignupInput = { businessName: string; ownerName: string; phone: string; email: string; password: string }

/** Creates the company (ONBOARDING) and its owner's admin account. Returns the new user's id. */
export async function signupCompany(input: SignupInput): Promise<{ tenantId: string; userId: string }> {
  // A second company on a server still in log mode would see other
  // companies' rows through any unscoped query (docs/TENANCY.md).
  if (tenantGuardMode() !== 'throw') throw new OnboardingError('New companies cannot join this server yet. Please contact RailServe.')
  const businessName = input.businessName.trim()
  const ownerName = input.ownerName.trim()
  const phone = input.phone.replace(/\D/g, '').slice(-10)
  const email = input.email.trim().toLowerCase()
  if (businessName.length < 3) throw new OnboardingError('Enter your business name.')
  if (ownerName.length < 2) throw new OnboardingError('Enter your name.')
  if (!PHONE.test(phone)) throw new OnboardingError('Enter a 10-digit mobile number.')
  if (!EMAIL.test(email)) throw new OnboardingError('Enter a valid email address.')
  if (input.password.length < 8) throw new OnboardingError('Choose a password of at least 8 characters.')

  await connectDb()
  // Sign-in is by phone across the whole platform: one person, one number.
  if (await User.exists({ phone }).setOptions({ allTenants: true })) {
    throw new OnboardingError('This mobile number already has a RailServe account. Sign in instead, or use another number.')
  }
  let slug = slugFrom(businessName)
  for (let i = 2; await Tenant.exists({ slug }); i++) slug = `${slugFrom(businessName).slice(0, 33)}-${i}`

  const primary = await Tenant.findOne({ primary: true }).select('billing.feePaise').lean()
  const passwordHash = await bcrypt.hash(input.password, 10)
  const session = await mongoose.startSession()
  let ids: { tenantId: string; userId: string } | null = null
  try {
    await session.withTransaction(async () => {
      const [tenant] = await Tenant.create(
        [
          {
            name: businessName,
            slug,
            status: 'ONBOARDING',
            primary: false,
            settings: { contactPhone: phone, contactEmail: email },
            onboarding: {
              appliedAt: new Date(),
              ownerName,
              ownerEmail: email,
              documents: DOC_KINDS.map((d) => ({ kind: d.kind, status: 'MISSING' })),
              payment: { status: 'DUE', amountPaise: primary?.billing?.feePaise ?? null },
              notices: [],
            },
          },
        ],
        { session },
      )
      const [user] = await User.create(
        [{ tenantId: tenant._id, name: ownerName, phone, passwordHash, role: 'ADMIN', restaurantIds: [], active: true }],
        { session },
      )
      ids = { tenantId: String(tenant._id), userId: String(user._id) }
    })
  } finally {
    await session.endSession()
  }
  forgetPrimaryTenant()
  await addNotice(ids!.tenantId, {
    subject: `${businessName}: application received`,
    body: [
      `Thank you for applying to join RailServe, ${ownerName.split(/\s+/)[0]}.`,
      '',
      'Three steps and you can start taking orders:',
      '1. Upload your 5 documents. We check them within a day or two.',
      '2. Link the Gmail your aggregator orders arrive in.',
      '3. Pay the joining fee.',
      '',
      `Sign in with your mobile number ${phone} to continue.`,
    ].join('\n'),
  })
  return ids!
}

export type ApplicantView = {
  tenantId: string
  name: string
  status: string
  ownerName: string | null
  ownerEmail: string | null
  appliedAt: Date
  documents: (OnboardingDoc & { fileId: string | null })[]
  payment: { status: PaymentStatus; amountPaise: number | null; reference: string | null; claimedAt: Date | null; paidAt: Date | null }
  notices: { at: Date; kind: string | null; subject: string; body: string; emailedAt: Date | null; emailError: string | null }[]
  gmailLinked: boolean
  progress: Progress
  billing: { feePaise: number | null; upiId: string | null; bankDetails: string | null }
}

/** One company's application, for its own owner or a platform admin. */
export async function applicationOf(tenantId: string): Promise<ApplicantView | null> {
  if (!mongoose.isValidObjectId(tenantId)) return null
  await connectDb()
  const [t, primary, gmailLinked] = await Promise.all([
    Tenant.findById(tenantId).lean(),
    Tenant.findOne({ primary: true }).select('billing').lean(),
    isGmailLinked(tenantId),
  ])
  if (!t?.onboarding) return null
  const o = t.onboarding
  const documents = (o.documents ?? []).map((d) => ({ kind: d.kind, status: d.status as DocStatus, fileId: d.fileId ? String(d.fileId) : null, fileName: d.fileName ?? null, reason: d.reason ?? null, uploadedAt: d.uploadedAt ?? null }))
  const payment = {
    status: (o.payment?.status ?? 'DUE') as PaymentStatus,
    // The fee in force now, unless one was fixed when they applied.
    amountPaise: o.payment?.amountPaise ?? primary?.billing?.feePaise ?? null,
    reference: o.payment?.reference ?? null,
    claimedAt: o.payment?.claimedAt ?? null,
    paidAt: o.payment?.paidAt ?? null,
  }
  return {
    tenantId: String(t._id),
    name: t.name,
    status: t.status,
    ownerName: o.ownerName ?? null,
    ownerEmail: o.ownerEmail ?? null,
    appliedAt: o.appliedAt,
    documents,
    payment,
    notices: (o.notices ?? []).map((n) => ({ at: n.at, kind: n.kind ?? null, subject: n.subject, body: n.body, emailedAt: n.emailedAt ?? null, emailError: n.emailError ?? null })).reverse(),
    gmailLinked,
    progress: progressOf({ documents, payment }, gmailLinked),
    billing: { feePaise: primary?.billing?.feePaise ?? null, upiId: primary?.billing?.upiId ?? null, bankDetails: primary?.billing?.bankDetails ?? null },
  }
}

/** The applicant uploads (or re-uploads) one document. An accepted one is final. */
export async function uploadDocument(params: { tenantId: string; userId: string; kind: string; fileName: string; mime: string; bytes: Buffer }): Promise<void> {
  const { tenantId, userId, kind } = params
  if (!isDocKind(kind)) throw new OnboardingError('Unknown document.')
  if (!(UPLOAD_TYPES as readonly string[]).includes(params.mime)) throw new OnboardingError('Upload a photo (JPG or PNG) or a PDF.')
  if (params.bytes.length === 0) throw new OnboardingError('That file is empty.')
  if (params.bytes.length > MAX_UPLOAD_BYTES) throw new OnboardingError('That file is over 5 MB. Take a photo instead, or make the PDF smaller.')
  await connectDb()
  const t = await Tenant.findOne({ _id: tenantId, status: 'ONBOARDING' }).select('onboarding.documents').lean()
  if (!t?.onboarding) throw new OnboardingError('This application is not open for documents.')
  const current = t.onboarding.documents?.find((d) => d.kind === kind)
  if (current?.status === 'ACCEPTED') throw new OnboardingError(`${docLabel(kind)} is already accepted.`)

  const tid = new Types.ObjectId(tenantId)
  const file = await TenantFile.create({ tenantId: tid, kind, fileName: params.fileName.slice(0, 200) || `${kind}.bin`, mime: params.mime, size: params.bytes.length, data: params.bytes, uploadedBy: new Types.ObjectId(userId) })
  const entry = { kind, status: 'PENDING', fileId: file._id, fileName: file.fileName, uploadedAt: new Date(), reason: null, reviewedAt: null, reviewedBy: null }
  // $elemMatch, not two separate conditions: on a list, `status: { $ne:
  // 'ACCEPTED' }` means "no document is accepted", which stopped every
  // re-upload once any other document had been accepted.
  const res = await Tenant.updateOne(
    { _id: tenantId, 'onboarding.documents': { $elemMatch: { kind, status: { $ne: 'ACCEPTED' } } } },
    { $set: { 'onboarding.documents.$': entry } },
  )
  if (res.matchedCount === 0) {
    // No slot for this kind yet (an older application): add one.
    await Tenant.updateOne({ _id: tenantId, 'onboarding.documents.kind': { $ne: kind } }, { $push: { 'onboarding.documents': entry } })
  }
  // The file it replaces is no longer needed.
  if (current?.fileId) await TenantFile.deleteOne({ _id: current.fileId, tenantId: tid })
}

/** The applicant says they paid, with the UPI or bank reference, for us to check. */
export async function claimPayment(tenantId: string, reference: string): Promise<void> {
  const ref = reference.trim()
  if (ref.length < 4) throw new OnboardingError('Enter the UPI or bank reference number from your payment.')
  await connectDb()
  const res = await Tenant.updateOne(
    { _id: tenantId, status: 'ONBOARDING', 'onboarding.payment.status': { $ne: 'PAID' } },
    { $set: { 'onboarding.payment.status': 'CLAIMED', 'onboarding.payment.reference': ref.slice(0, 80), 'onboarding.payment.claimedAt': new Date() } },
  )
  if (res.matchedCount === 0) throw new OnboardingError('This payment is already confirmed.')
}

/* ── the platform admin's side ──────────────────────────────────────────── */

export type ApplicationRow = { tenantId: string; name: string; ownerName: string | null; phone: string | null; appliedAt: Date; progress: Progress; paymentStatus: PaymentStatus; toReview: number }

/** Companies still joining, the ones with something to review first. */
export async function listApplications(): Promise<ApplicationRow[]> {
  await connectDb()
  const rows = await Tenant.find({ status: 'ONBOARDING' }).select('name settings.contactPhone onboarding').sort({ 'onboarding.appliedAt': -1 }).lean()
  const out: ApplicationRow[] = []
  for (const t of rows) {
    if (!t.onboarding) continue
    const documents = (t.onboarding.documents ?? []).map((d) => ({ kind: d.kind, status: d.status as DocStatus }))
    const paymentStatus = (t.onboarding.payment?.status ?? 'DUE') as PaymentStatus
    const progress = progressOf({ documents, payment: { status: paymentStatus } }, await isGmailLinked(String(t._id)))
    out.push({
      tenantId: String(t._id),
      name: t.name,
      ownerName: t.onboarding.ownerName ?? null,
      phone: t.settings?.contactPhone ?? null,
      appliedAt: t.onboarding.appliedAt,
      progress,
      paymentStatus,
      toReview: progress.documents.pending + (paymentStatus === 'CLAIMED' ? 1 : 0),
    })
  }
  return out.sort((a, b) => b.toReview - a.toReview || b.appliedAt.getTime() - a.appliedAt.getTime())
}

/** Accept or reject one document. A rejection needs a reason the applicant can act on. */
export async function reviewDocument(params: { tenantId: string; kind: string; accept: boolean; reason?: string | null; adminId: string }): Promise<void> {
  const reason = params.reason?.trim() || null
  if (!params.accept && (!reason || reason.length < 5)) throw new OnboardingError('Say why, so they know what to upload instead.')
  await connectDb()
  const res = await Tenant.updateOne(
    { _id: params.tenantId, status: 'ONBOARDING', 'onboarding.documents': { $elemMatch: { kind: params.kind, status: { $in: ['PENDING', 'ACCEPTED', 'REJECTED'] } } } },
    {
      $set: {
        'onboarding.documents.$.status': params.accept ? 'ACCEPTED' : 'REJECTED',
        'onboarding.documents.$.reason': params.accept ? null : reason,
        'onboarding.documents.$.reviewedAt': new Date(),
        'onboarding.documents.$.reviewedBy': new Types.ObjectId(params.adminId),
      },
    },
  )
  if (res.matchedCount === 0) throw new OnboardingError('Nothing uploaded for that document yet.')
  await noteReview(params.tenantId)
  await activateIfReady(params.tenantId)
}

/** How long one review sitting lasts: decisions inside it go out as one message. */
export const REVIEW_SITTING_MS = 30 * 60_000

/**
 * One message per review sitting, not per document: a reviewer who accepts
 * four documents and rejects one in a few minutes sends one message listing
 * all five. The latest review message is rewritten while it is recent and
 * not yet emailed; otherwise a new one starts.
 */
async function noteReview(tenantId: string, now = new Date()): Promise<void> {
  const t = await Tenant.findById(tenantId).select('name onboarding.documents onboarding.notices').lean()
  if (!t?.onboarding) return
  const notices = t.onboarding.notices ?? []
  const last = notices.length ? notices[notices.length - 1] : null
  const open = last && last.kind === 'REVIEW' && !last.emailedAt && now.getTime() - new Date(last.at).getTime() < REVIEW_SITTING_MS
  const since = open ? new Date(last!.at) : new Date(now.getTime() - 1000)
  const decided = (t.onboarding.documents ?? [])
    .filter((d) => d.reviewedAt && new Date(d.reviewedAt) >= since && (d.status === 'ACCEPTED' || d.status === 'REJECTED'))
    .map((d) => ({ kind: d.kind, accepted: d.status === 'ACCEPTED', reason: d.reason ?? null }))
  if (decided.length === 0) return
  const app = await applicationOf(tenantId)
  if (!app) return
  const n = reviewNotice(app.name, decided, app.progress)
  if (open) {
    await Tenant.updateOne(
      { _id: tenantId },
      { $set: { [`onboarding.notices.${notices.length - 1}.subject`]: n.subject, [`onboarding.notices.${notices.length - 1}.body`]: n.body, [`onboarding.notices.${notices.length - 1}.updatedAt`]: now } },
    )
  } else {
    await Tenant.updateOne({ _id: tenantId }, { $push: { 'onboarding.notices': { at: since, updatedAt: now, kind: 'REVIEW', subject: n.subject, body: n.body } } })
  }
}

/** A platform admin confirms the money arrived (whether or not the applicant said they paid). */
export async function markPaymentReceived(params: { tenantId: string; adminId: string; note?: string | null }): Promise<void> {
  await connectDb()
  const res = await Tenant.updateOne(
    { _id: params.tenantId, status: 'ONBOARDING' },
    { $set: { 'onboarding.payment.status': 'PAID', 'onboarding.payment.paidAt': new Date(), 'onboarding.payment.markedBy': new Types.ObjectId(params.adminId), 'onboarding.payment.note': params.note?.trim() || null } },
  )
  if (res.matchedCount === 0) throw new OnboardingError('This company is not joining any more.')
  const app = await applicationOf(params.tenantId)
  if (app) await addNotice(params.tenantId, { subject: `${app.name}: payment received`, body: `We have received your payment for ${app.name}. Thank you.` })
  await activateIfReady(params.tenantId)
}

/**
 * Turns an application down. The company is archived (kept for the record),
 * its documents deleted and any linked Gmail unlinked, and the applicant's
 * account removed, so their phone number is free to be used again: sign-in
 * is by phone across the whole platform, and an application nobody can close
 * would hold that number forever. They are told why.
 */
export async function declineApplication(params: { tenantId: string; adminId: string; reason: string }): Promise<void> {
  const reason = params.reason.trim()
  if (reason.length < 5) throw new OnboardingError('Say why, so they know.')
  await connectDb()
  const t = await Tenant.findOne({ _id: params.tenantId, status: 'ONBOARDING' }).select('name').lean()
  if (!t) throw new OnboardingError('This company is not joining any more.')
  const tid = new Types.ObjectId(params.tenantId)
  await unlinkMailbox(params.tenantId)
  await TenantFile.deleteMany({ tenantId: tid })
  await User.deleteMany({ tenantId: tid })
  await Tenant.updateOne(
    { _id: tid },
    {
      $set: { status: 'ARCHIVED', suspendedAt: new Date(), suspendedReason: `Application declined: ${reason}`, 'onboarding.documents.$[].fileId': null },
    },
  )
  await addNotice(params.tenantId, {
    subject: `${t.name}: application not accepted`,
    body: `We are sorry: we cannot accept ${t.name} on RailServe at this time.\n\nReason: ${reason}\n\nYour account and documents have been removed. You are welcome to apply again.`,
  })
}

/**
 * Lets the company in once every step is done: documents accepted, Gmail
 * linked, payment received. Called after each of those changes.
 */
export async function activateIfReady(tenantId: string): Promise<boolean> {
  const app = await applicationOf(tenantId)
  if (!app || app.status !== 'ONBOARDING' || !app.progress.ready) return false
  const res = await Tenant.updateOne({ _id: tenantId, status: 'ONBOARDING' }, { $set: { status: 'ACTIVE', 'onboarding.approvedAt': new Date() } })
  if (res.modifiedCount === 0) return false
  await startReadingOnApproval(tenantId)
  await addNotice(tenantId, {
    subject: `${app.name} is ready on RailServe`,
    body: `Everything is done for ${app.name}. Sign in to RailServe to add your kitchens and staff and start taking orders.`,
  })
  await ensureIndexes({ multiTenant: true })
  return true
}

async function addNotice(tenantId: string, n: { subject: string; body: string }): Promise<void> {
  const at = new Date()
  await Tenant.updateOne({ _id: tenantId }, { $push: { 'onboarding.notices': { at, updatedAt: at, subject: n.subject, body: n.body } } })
}

/** One uploaded document, for its own company or a platform admin; null for anyone else. */
export async function readTenantFile(params: { fileId: string; tenantId: string }) {
  if (!mongoose.isValidObjectId(params.fileId) || !mongoose.isValidObjectId(params.tenantId)) return null
  await connectDb()
  return TenantFile.findOne({ _id: params.fileId, tenantId: new Types.ObjectId(params.tenantId) }).lean()
}

/** The fee and how to pay it, as set now. */
export async function loadBilling(): Promise<{ feePaise: number | null; upiId: string | null; bankDetails: string | null }> {
  await connectDb()
  const t = await Tenant.findOne({ primary: true }).select('billing').lean()
  return { feePaise: t?.billing?.feePaise ?? null, upiId: t?.billing?.upiId ?? null, bankDetails: t?.billing?.bankDetails ?? null }
}

/** The fee and how to pay it, set by a platform admin and shown to every applicant. */
export async function saveBilling(input: { feeRupees: string; upiId: string; bankDetails: string }): Promise<void> {
  const fee = input.feeRupees.trim() ? Math.round(Number(input.feeRupees) * 100) : null
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) throw new OnboardingError('Enter the fee in rupees.')
  await connectDb()
  await Tenant.updateOne({ primary: true }, { $set: { 'billing.feePaise': fee, 'billing.upiId': input.upiId.trim() || null, 'billing.bankDetails': input.bankDetails.trim() || null } })
}

/** The owner of an application: name and phone, for the reviewer to call. */
export async function applicantOwner(tenantId: string): Promise<{ name: string; phone: string } | null> {
  if (!mongoose.isValidObjectId(tenantId)) return null
  await connectDb()
  const u = await User.findOne({ tenantId: new Types.ObjectId(tenantId), role: 'ADMIN' }).select('name phone').sort({ createdAt: 1 }).lean()
  return u ? { name: u.name, phone: u.phone } : null
}

/* ── emailing the messages ──────────────────────────────────────────────── */

/** A review message waits until the review has been quiet this long, so one sitting is one email. */
export const REVIEW_QUIET_MS = 10 * 60_000
const MAX_ATTEMPTS = 3

/**
 * Emails every message an applicant has not been sent yet. Run every minute
 * (/api/cron/gmail-sync). Each message is claimed before it is sent, so two
 * runs never send it twice; a failure is recorded and retried, at most three
 * times. Messages older than two weeks are left alone.
 */
export async function sendPendingNotices(opts: { send?: (to: string, subject: string, text: string) => Promise<void>; now?: Date } = {}): Promise<{ sent: number; failed: number; skipped?: string }> {
  const send = opts.send ?? sendMail
  const now = opts.now ?? new Date()
  if (!opts.send && !isMailerConfigured()) return { sent: 0, failed: 0, skipped: 'sending is not set up' }
  await connectDb()
  const since = new Date(now.getTime() - 14 * 86_400_000)
  const tenants = await Tenant.find({ 'onboarding.notices': { $elemMatch: { emailedAt: null, at: { $gte: since }, attempts: { $not: { $gte: MAX_ATTEMPTS } } } } })
    .select('name onboarding.ownerEmail onboarding.notices')
    .lean()
  let sent = 0
  let failed = 0
  for (const t of tenants) {
    const to = t.onboarding?.ownerEmail
    const notices = t.onboarding?.notices ?? []
    for (let i = 0; i < notices.length; i++) {
      const n = notices[i]
      if (n.emailedAt || new Date(n.at) < since || (n.attempts ?? 0) >= MAX_ATTEMPTS) continue
      if (n.kind === 'REVIEW' && now.getTime() - new Date(n.updatedAt ?? n.at).getTime() < REVIEW_QUIET_MS) continue
      const path = `onboarding.notices.${i}`
      if (!to) {
        await Tenant.updateOne({ _id: t._id }, { $set: { [`${path}.emailError`]: 'No email address on the application', [`${path}.attempts`]: MAX_ATTEMPTS } })
        continue
      }
      // Claim it first: a second run sees it as sent and leaves it.
      const claim = await Tenant.updateOne({ _id: t._id, [`${path}.emailedAt`]: null, [`${path}.at`]: n.at }, { $set: { [`${path}.emailedAt`]: now } })
      if (claim.modifiedCount === 0) continue
      try {
        await send(to, n.subject, n.body)
        await Tenant.updateOne({ _id: t._id }, { $set: { [`${path}.emailError`]: null } })
        sent += 1
      } catch (err) {
        const message = (err instanceof Error ? err.message : 'send failed').slice(0, 200)
        await Tenant.updateOne({ _id: t._id }, { $set: { [`${path}.emailedAt`]: null, [`${path}.emailError`]: message }, $inc: { [`${path}.attempts`]: 1 } })
        failed += 1
      }
    }
  }
  return { sent, failed }
}
