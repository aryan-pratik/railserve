import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { GMAIL_STATE_ID, IngestState, Mailbox, Tenant, TenantFile, User } from '../src/lib/models'
import { tenantKey } from '../src/lib/tenancy/primary'
import { MailboxError, isGmailLinked, linkMailbox, mailboxOf, unlinkMailbox } from '../src/lib/repo/mailboxRepo'
import { loadUser } from '../src/lib/tenancy/userContext'
import { setTenantStatus, PlatformInputError } from '../src/lib/repo/platformRepo'
import {
  OnboardingError, activateIfReady, declineApplication, applicationOf, claimPayment, listApplications, markPaymentReceived, readTenantFile,
  reviewDocument, saveBilling, sendPendingNotices, signupCompany, uploadDocument,
} from '../src/lib/repo/onboardingRepo'
import { DOC_KINDS, progressOf, reviewNotice, slugFrom } from '../src/lib/onboarding'
import { makeUser, resetDb, tenantId } from './fixtures'

const PDF = Buffer.from('%PDF-1.4 test')

describe('the onboarding rules', () => {
  it('opens Gmail only once every document is accepted, and is ready only when all three steps are done', () => {
    const docs = DOC_KINDS.map((d) => ({ kind: d.kind, status: 'ACCEPTED' as const }))
    expect(progressOf({ documents: docs.slice(0, 4), payment: { status: 'PAID' } }, false).gmail.state).toBe('locked')
    expect(progressOf({ documents: docs, payment: { status: 'DUE' } }, false)).toMatchObject({ gmail: { state: 'todo' }, ready: false, doneCount: 1 })
    expect(progressOf({ documents: docs, payment: { status: 'CLAIMED' } }, true)).toMatchObject({ payment: { state: 'waiting' }, ready: false })
    expect(progressOf({ documents: docs, payment: { status: 'PAID' } }, true)).toMatchObject({ ready: true, doneCount: 3 })
  })
  it('asks the applicant to act when a document is missing or sent back, and waits when all are with us', () => {
    const pending = DOC_KINDS.map((d) => ({ kind: d.kind, status: 'PENDING' as const }))
    expect(progressOf({ documents: pending, payment: { status: 'DUE' } }, false).documents.state).toBe('waiting')
    expect(progressOf({ documents: [{ ...pending[0], status: 'REJECTED' as const }, ...pending.slice(1)], payment: { status: 'DUE' } }, false).documents).toMatchObject({ state: 'todo', rejected: 1 })
  })
  it('makes a handle from the business name and words a rejection plainly', () => {
    expect(slugFrom('Bite Station, Gaya!')).toBe('bite-station-gaya')
    const n = reviewNotice('Bite Station', [{ kind: 'GST', accepted: false, reason: 'Photo is blurred' }], progressOf({ documents: [], payment: { status: 'DUE' } }, false))
    expect(n.subject).toMatch(/uploaded again/)
    expect(n.body).toContain('GST certificate: not accepted. Photo is blurred')
  })
})

describe('a company joining on its own', () => {
  let admin: { id: string }
  let applicant: { tenantId: string; userId: string }

  beforeAll(async () => {
    await resetDb()
    const a = await makeUser('ADMIN', '9500000001')
    admin = { id: String(a._id) }
    await saveBilling({ feeRupees: '4999', upiId: 'railserve@hdfc', bankDetails: 'RailServe\nA/c 123' })
    applicant = await signupCompany({ businessName: 'Bite Station Gaya', ownerName: 'Ravi Owner', phone: '98765 43210', email: 'Owner@Example.com', password: 'secret123' })
  })
  afterAll(async () => {
    await disconnectDb()
  })

  it('creates a joining company and its owner, with the fee in force', async () => {
    const t = await Tenant.findById(applicant.tenantId).lean()
    expect(t).toMatchObject({ status: 'ONBOARDING', name: 'Bite Station Gaya', slug: 'bite-station-gaya' })
    expect(t?.onboarding?.ownerEmail).toBe('owner@example.com')
    expect(t?.onboarding?.payment?.amountPaise).toBe(499900)
    const u = await User.findById(applicant.userId).setOptions({ allTenants: true }).lean()
    expect(u).toMatchObject({ role: 'ADMIN', phone: '9876543210' })
  })

  it('refuses a phone number that already has an account anywhere', async () => {
    await expect(signupCompany({ businessName: 'Other', ownerName: 'X Y', phone: '9500000001', email: 'x@y.in', password: 'secret123' })).rejects.toBeInstanceOf(OnboardingError)
  })

  it('signs the owner in for the onboarding screen only, and nobody else from that company', async () => {
    const owner = await loadUser(applicant.userId)
    expect(owner?.onboarding).toBe(true)
    const staff = await User.create({ tenantId: new mongoose.Types.ObjectId(applicant.tenantId), name: 'Cook', phone: '9876500000', passwordHash: 'x', role: 'STORE_MANAGER', restaurantIds: [], active: true })
    expect(await loadUser(String(staff._id))).toBeNull()
  })

  it('takes uploads, refuses the wrong kind of file, and keeps only the latest file', async () => {
    await expect(uploadDocument({ ...applicant, kind: 'GST', fileName: 'x.exe', mime: 'application/x-msdownload', bytes: PDF })).rejects.toBeInstanceOf(OnboardingError)
    for (const d of DOC_KINDS) await uploadDocument({ ...applicant, kind: d.kind, fileName: `${d.kind}.pdf`, mime: 'application/pdf', bytes: PDF })
    await uploadDocument({ ...applicant, kind: 'GST', fileName: 'gst-2.pdf', mime: 'application/pdf', bytes: PDF })
    expect(await TenantFile.countDocuments({ tenantId: new mongoose.Types.ObjectId(applicant.tenantId) })).toBe(5)
    const app = await applicationOf(applicant.tenantId)
    expect(app?.progress.documents).toMatchObject({ state: 'waiting', pending: 5 })
    const gst = app!.documents.find((d) => d.kind === 'GST')!
    expect(gst.fileName).toBe('gst-2.pdf')
    // The file reads back for its own company, and not under another company's id.
    expect(await readTenantFile({ fileId: gst.fileId!, tenantId: applicant.tenantId })).not.toBeNull()
    expect(await readTenantFile({ fileId: gst.fileId!, tenantId: String(tenantId()) })).toBeNull()
  })

  it('sends a document back with a reason, records a message, and takes a new upload', async () => {
    await expect(reviewDocument({ tenantId: applicant.tenantId, kind: 'PAN', accept: false, reason: '', adminId: admin.id })).rejects.toBeInstanceOf(OnboardingError)
    await reviewDocument({ tenantId: applicant.tenantId, kind: 'PAN', accept: false, reason: 'The photo is blurred', adminId: admin.id })
    let app = await applicationOf(applicant.tenantId)
    expect(app?.documents.find((d) => d.kind === 'PAN')).toMatchObject({ status: 'REJECTED', reason: 'The photo is blurred' })
    expect(app?.notices[0]).toMatchObject({ kind: 'REVIEW', subject: expect.stringMatching(/uploaded again/) })
    expect((await listApplications())[0]).toMatchObject({ name: 'Bite Station Gaya', toReview: 4 })

    // Re-uploading the rejected one while another is already accepted.
    await reviewDocument({ tenantId: applicant.tenantId, kind: 'GST', accept: true, adminId: admin.id })
    await uploadDocument({ ...applicant, kind: 'PAN', fileName: 'pan-clear.jpg', mime: 'image/jpeg', bytes: PDF })
    const pan = (await applicationOf(applicant.tenantId))!.documents.find((d) => d.kind === 'PAN')!
    expect(pan).toMatchObject({ status: 'PENDING', fileName: 'pan-clear.jpg', reason: null })
    expect(await readTenantFile({ fileId: pan.fileId!, tenantId: applicant.tenantId })).not.toBeNull()
    for (const d of DOC_KINDS) await reviewDocument({ tenantId: applicant.tenantId, kind: d.kind, accept: true, adminId: admin.id })
    app = await applicationOf(applicant.tenantId)
    expect(app?.progress).toMatchObject({ documents: { state: 'done' }, gmail: { state: 'todo' } })
    // One sitting, one message: the rejection and the five acceptances together.
    const reviews = app!.notices.filter((n) => n.kind === 'REVIEW')
    expect(reviews).toHaveLength(1)
    expect(reviews[0].body).toContain('FSSAI food licence: accepted')
    expect(reviews[0].body).toContain('PAN card: accepted')
    await expect(uploadDocument({ ...applicant, kind: 'PAN', fileName: 'again.pdf', mime: 'application/pdf', bytes: PDF })).rejects.toThrow(/already accepted/)
  })

  it('takes a payment claim, lets an admin confirm it, and still waits for Gmail before letting the company in', async () => {
    await claimPayment(applicant.tenantId, 'UTR 4321098765')
    expect((await applicationOf(applicant.tenantId))?.progress.payment.state).toBe('waiting')
    await markPaymentReceived({ tenantId: applicant.tenantId, adminId: admin.id, note: 'HDFC' })
    expect(await activateIfReady(applicant.tenantId)).toBe(false)
    expect((await Tenant.findById(applicant.tenantId).lean())?.status).toBe('ONBOARDING')
  })

  it('cannot be switched on from the companies list, bypassing review', async () => {
    await expect(setTenantStatus(applicant.tenantId, 'ACTIVE', null)).rejects.toBeInstanceOf(PlatformInputError)
  })

  it("refuses a Gmail that already feeds another company", async () => {
    await linkMailbox({ tenantId: String(tenantId()), userId: admin.id, email: 'Kitchen@Primary.in', refreshToken: 'p-token', historyId: '10', found: 40 })
    await expect(linkMailbox({ tenantId: applicant.tenantId, userId: applicant.userId, email: 'kitchen@primary.in', refreshToken: 'x', historyId: null, found: 0 })).rejects.toBeInstanceOf(MailboxError)
  })

  it('lets the company in on its own once Gmail is linked, after documents and payment', async () => {
    await linkMailbox({ tenantId: applicant.tenantId, userId: applicant.userId, email: 'wrong@gmail.com', refreshToken: 'a-token', historyId: '500', found: 0 })
    expect(await mailboxOf(applicant.tenantId)).toMatchObject({ email: 'wrong@gmail.com', foundAtLink: 0 })
    // Changing to the right Gmail replaces it and starts from Google's position now.
    const r = await linkMailbox({ tenantId: applicant.tenantId, userId: applicant.userId, email: 'orders@bitestation.in', refreshToken: 'b-token', historyId: '900', found: 37 })
    expect(r.replaced).toBe('wrong@gmail.com')
    const tid = new mongoose.Types.ObjectId(applicant.tenantId)
    expect((await IngestState.findOne({ _id: await tenantKey(tid, GMAIL_STATE_ID), tenantId: tid }).lean())?.historyId).toBe('900')
    expect((await Mailbox.findOne({ tenantId: tid }).lean())?.tokenSealed).not.toContain('b-token')

    expect(await activateIfReady(applicant.tenantId)).toBe(true)
    expect((await Tenant.findById(applicant.tenantId).lean())?.status).toBe('ACTIVE')
    expect((await loadUser(applicant.userId))?.onboarding).toBe(false)
    expect((await applicationOf(applicant.tenantId))?.notices[0].subject).toMatch(/is ready on RailServe/)
  })

  it('unlinks: no mailbox, and no resume point left behind', async () => {
    expect(await unlinkMailbox(applicant.tenantId)).toBe('orders@bitestation.in')
    expect(await isGmailLinked(applicant.tenantId)).toBe(false)
    const tid = new mongoose.Types.ObjectId(applicant.tenantId)
    expect((await IngestState.findOne({ _id: await tenantKey(tid, GMAIL_STATE_ID), tenantId: tid }).lean())?.historyId).toBeUndefined()
  })
})

describe('declining an application', () => {
  it('archives the company, removes the account and documents, frees the phone, and says why', async () => {
    await resetDb()
    const a = await makeUser('ADMIN', '9822200002')
    const app = await signupCompany({ businessName: 'Junk Foods', ownerName: 'Spam Er', phone: '9822200001', email: 'junk@example.com', password: 'secret123' })
    await uploadDocument({ ...app, kind: 'GST', fileName: 'x.pdf', mime: 'application/pdf', bytes: PDF })
    await expect(declineApplication({ tenantId: app.tenantId, adminId: String(a._id), reason: '' })).rejects.toBeInstanceOf(OnboardingError)
    await declineApplication({ tenantId: app.tenantId, adminId: String(a._id), reason: 'Not a train food business' })
    const t = await Tenant.findById(app.tenantId).lean()
    expect(t?.status).toBe('ARCHIVED')
    expect(t?.onboarding?.notices?.at(-1)?.body).toContain('Not a train food business')
    expect(await User.exists({ tenantId: t!._id }).setOptions({ allTenants: true })).toBeNull()
    expect(await TenantFile.countDocuments({ tenantId: t!._id })).toBe(0)
    await expect(setTenantStatus(app.tenantId, 'ACTIVE', null)).rejects.toBeInstanceOf(PlatformInputError)
    // The number is free again.
    await expect(signupCompany({ businessName: 'Real Foods', ownerName: 'Real Owner', phone: '9822200001', email: 'real@example.com', password: 'secret123' })).resolves.toBeTruthy()
  })
})

describe('emailing the messages', () => {
  it('builds a plain message with an encoded subject, and refuses a header that could smuggle another', async () => {
    const { buildMessage } = await import('../src/lib/mailer')
    const raw = Buffer.from(buildMessage('owner@example.com', 'Bite Station: documents accepted ✓', 'Hello\nAll good'), 'base64url').toString('utf8')
    expect(raw).toContain('To: owner@example.com')
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/)
    expect(raw).not.toMatch(/^From:/m)
    expect(() => buildMessage('a@b.in\r\nBcc: x@y.in', 's', 't')).toThrow()
  })

  it('sends each message once, waits for a review to go quiet, and retries a failure at most three times', async () => {
    await resetDb()
    const app = await signupCompany({ businessName: 'Mail Test Foods', ownerName: 'Asha', phone: '9811100001', email: 'asha@example.com', password: 'secret123' })
    const a = await makeUser('ADMIN', '9811100002')
    for (const d of DOC_KINDS) await uploadDocument({ ...app, kind: d.kind, fileName: 'x.pdf', mime: 'application/pdf', bytes: PDF })
    const t0 = Date.now()
    await reviewDocument({ tenantId: app.tenantId, kind: 'GST', accept: true, adminId: String(a._id) })
    await reviewDocument({ tenantId: app.tenantId, kind: 'PAN', accept: false, reason: 'Blurred photo', adminId: String(a._id) })

    const outbox: { to: string; subject: string; body: string }[] = []
    const send = async (to: string, subject: string, body: string) => {
      outbox.push({ to, subject, body })
    }
    // Right away: the welcome goes, the review waits for the sitting to end.
    expect(await sendPendingNotices({ send, now: new Date(t0 + 1000) })).toMatchObject({ sent: 1 })
    expect(outbox[0]).toMatchObject({ to: 'asha@example.com', subject: 'Mail Test Foods: application received' })
    // Ten quiet minutes later: one email for both decisions, and never again.
    expect(await sendPendingNotices({ send, now: new Date(t0 + 11 * 60_000) })).toMatchObject({ sent: 1 })
    expect(outbox[1].body).toContain('GST certificate: accepted')
    expect(outbox[1].body).toContain('PAN card: not accepted. Blurred photo')
    expect(await sendPendingNotices({ send, now: new Date(t0 + 12 * 60_000) })).toMatchObject({ sent: 0 })

    await markPaymentReceived({ tenantId: app.tenantId, adminId: String(a._id) })
    const broken = async () => {
      throw new Error('quota exceeded')
    }
    for (let i = 0; i < 5; i++) await sendPendingNotices({ send: broken, now: new Date(t0 + 13 * 60_000) })
    const n = (await applicationOf(app.tenantId))!.notices.find((x) => /payment received/.test(x.subject))!
    expect(n).toMatchObject({ emailedAt: null, emailError: 'quota exceeded' })
    const raw = await Tenant.findById(app.tenantId).lean()
    expect(raw!.onboarding!.notices!.find((x) => /payment received/.test(x.subject))!.attempts).toBe(3)
  })
})
