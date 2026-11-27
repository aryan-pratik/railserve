import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ArrowRight, BadgeIndianRupee, Check, Clock, FileText, Lock, LogOut, Mail, X } from 'lucide-react'
import { requireApplicant } from '@/lib/session'
import { applicationOf } from '@/lib/repo/onboardingRepo'
import { documentSlots, type StepState } from '@/lib/onboarding'
import { formatIST, formatRupees } from '@/lib/format'
import { logout } from '@/app/actions/session'
import { cx } from '@/components/v2/ui'
import { OnboardingUpload } from '@/components/v2/OnboardingUpload'
import { OnboardingPaymentForm } from '@/components/v2/OnboardingPayment'
import { KitchenCopyButton } from '@/components/v2/KitchenBits'
import { GmailLinkCard } from '@/components/v2/GmailLinkCard'
import { DocPreview } from '@/components/v2/DocPreview'
import { gmailCardData } from '@/lib/v2/gmailCard'

export const metadata = { title: 'Joining RailServe' }
export const dynamic = 'force-dynamic'

/**
 * What a company that applied sees until it is let in: three steps, each
 * with its state in plain words, and every message from us. Nothing else in
 * the app opens for them until all three are done (lib/session).
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireApplicant()
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const [app, gmail] = await Promise.all([applicationOf(me.tenantId), gmailCardData(me.tenantId, 'onboarding', { gmail: one(sp.gmail), reason: one(sp.reason) })])
  if (!app) redirect('/')
  const p = app.progress
  const slots = documentSlots(app.documents).map((s) => ({ ...s, fileId: app.documents.find((d) => d.kind === s.kind)?.fileId ?? null }))

  // One step on screen at a time: the one asked for, else (coming back from
  // Google) Gmail, else the first one that is theirs to do.
  const requested = one(sp.step)
  const firstTodo: StepKey = p.documents.state === 'todo' ? 'documents' : p.gmail.state === 'todo' ? 'gmail' : p.payment.state === 'todo' ? 'payment' : 'documents'
  const step: StepKey = isStepKey(requested) ? requested : one(sp.gmail) ? 'gmail' : firstTodo
  const at = STEPS.indexOf(step)
  const prev = at > 0 ? STEPS[at - 1] : null
  const next = at < STEPS.length - 1 ? STEPS[at + 1] : null

  return (
    <main className="min-h-dvh bg-v2-bg font-v2 text-v2-ink antialiased">
      <header className="border-b border-v2-line bg-v2-surface">
        <div className="mx-auto flex max-w-[880px] items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-[-0.02em]">
            <span className="relative inline-block h-[28px] w-[28px] rounded-[9px] bg-v2-brand" aria-hidden>
              <span className="absolute left-[7px] right-[7px] top-[8px] h-[3px] rounded bg-v2-mint" />
              <span className="absolute left-[7px] right-[11px] top-[16px] h-[3px] rounded bg-v2-mint" />
            </span>
            RailServe
          </span>
          <form action={logout}>
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] font-semibold text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink">
              <LogOut size={15} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto grid max-w-[880px] gap-6 px-4 py-8">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-v2-muted">{app.name}</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.02em]">Welcome, {me.name.split(/\s+/)[0]}</h1>
          <p className="mt-1 text-[15px] text-v2-muted">Three steps and you can start taking orders. {p.doneCount} of 3 done.</p>
        </div>

        <nav aria-label="Steps">
          <ol className="grid grid-cols-3 gap-2">
            <Stepper n={1} label="Documents" state={p.documents.state} current={step === 'documents'} href="?step=documents" />
            <Stepper n={2} label="Link Gmail" state={p.gmail.state} current={step === 'gmail'} href="?step=gmail" />
            <Stepper n={3} label="Payment" state={p.payment.state} current={step === 'payment'} href="?step=payment" />
          </ol>
        </nav>

        {/* 1. Documents */}
        {step === 'documents' ? (
        <Section n={1} title="Upload your documents" state={p.documents.state} icon={<FileText size={20} aria-hidden />}
          summary={
            p.documents.state === 'done'
              ? 'All 5 documents are accepted.'
              : p.documents.rejected
                ? `${p.documents.rejected} document${p.documents.rejected === 1 ? ' needs' : 's need'} to be uploaded again. See the reason in red.`
                : p.documents.missing
                  ? `Upload all 5. Photos or PDFs are fine. ${p.documents.accepted} accepted so far.`
                  : 'Thank you. We are checking your documents and will tell you here, and by email. Meanwhile you can pay the joining fee.'
          }
        >
          <ul className="divide-y divide-v2-line overflow-hidden rounded-v2-lg border border-v2-line">
            {slots.map((d) => (
              <li key={d.kind} className={cx('grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center', d.status === 'REJECTED' && 'bg-v2-bad-bg/40')}>
                <div className="flex gap-3">
                  <DocIcon status={d.status} />
                  <div className="min-w-0">
                    <p className="text-[15.5px] font-semibold">{d.label}</p>
                    <p className="text-[13px] text-v2-muted">{d.hint}</p>
                    <p className={cx('mt-1 text-[13px] font-semibold', d.status === 'ACCEPTED' ? 'text-v2-ok' : d.status === 'REJECTED' ? 'text-v2-bad' : d.status === 'PENDING' ? 'text-v2-warn' : 'text-v2-muted')}>
                      {d.status === 'ACCEPTED' ? 'Accepted' : d.status === 'REJECTED' ? 'Not accepted' : d.status === 'PENDING' ? 'Uploaded. We are checking it.' : 'Not uploaded yet'}
                      {d.fileName && d.fileId ? (
                        <>
                          {' · '}
                          <DocPreview href={`/api/tenant-files/${d.fileId}?tenant=${app.tenantId}`} fileName={d.fileName} title={d.label} className="font-normal" />
                        </>
                      ) : null}
                    </p>
                    {d.status === 'REJECTED' && d.reason ? (
                      <p className="mt-2 rounded-v2-sm border border-v2-bad/30 bg-v2-surface px-3 py-2 text-[13.5px] text-v2-ink">
                        <b className="text-v2-bad">Why: </b>
                        {d.reason}
                      </p>
                    ) : null}
                  </div>
                </div>
                {d.status === 'ACCEPTED' ? null : (
                  <OnboardingUpload kind={d.kind} label={d.label} again={d.status === 'REJECTED' || d.status === 'PENDING'} />
                )}
              </li>
            ))}
          </ul>
        </Section>

        ) : null}

        {/* 2. Gmail */}
        {step === 'gmail' ? (
        <Section n={2} title="Link your Gmail" state={p.gmail.state} icon={<Mail size={20} aria-hidden />}
          summary={
            p.gmail.state === 'done'
              ? 'Your Gmail is linked. Orders from aggregators will arrive on their own once you are in.'
              : p.gmail.state === 'locked'
                ? 'This opens once all 5 documents are accepted.'
                : 'Link the Gmail account where emails from IRCTC eCatering, RailRestro, Zoop and other aggregators arrive.'
          }
        >
          {p.gmail.state !== 'locked' ? <GmailLinkCard data={gmail} /> : gmail.banner ? <p role="status" className="rounded-v2-md bg-v2-bad-bg px-4 py-3 text-[14px] font-medium text-v2-bad">{gmail.banner.text}</p> : null}
        </Section>

        ) : null}

        {/* 3. Payment */}
        {step === 'payment' ? (
        <Section n={3} title="Pay the joining fee" state={p.payment.state} icon={<BadgeIndianRupee size={20} aria-hidden />}
          summary={
            p.payment.state === 'done'
              ? `Payment received${app.payment.paidAt ? ` on ${formatIST(app.payment.paidAt)}` : ''}. Thank you.`
              : p.payment.state === 'waiting'
                ? `We are checking your payment (reference ${app.payment.reference}). We will confirm it here.`
                : 'Pay by UPI or bank transfer, then tell us the reference number.'
          }
        >
          {p.payment.state !== 'done' ? (
            <div className="grid gap-4 rounded-v2-lg border border-v2-line bg-v2-surface p-4">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <span>
                  <span className="block text-[12.5px] font-semibold text-v2-muted">Amount</span>
                  <span className="text-[26px] font-bold">{app.payment.amountPaise != null ? formatRupees(app.payment.amountPaise) : 'We will tell you'}</span>
                </span>
                {app.billing.upiId ? (
                  <span>
                    <span className="block text-[12.5px] font-semibold text-v2-muted">UPI ID</span>
                    <span className="inline-flex items-center gap-1 font-mono text-[16px] font-semibold">
                      {app.billing.upiId}
                      <KitchenCopyButton text={app.billing.upiId} label="Copy UPI ID" />
                    </span>
                  </span>
                ) : null}
              </div>
              {app.billing.bankDetails ? (
                <div>
                  <span className="block text-[12.5px] font-semibold text-v2-muted">Or bank transfer</span>
                  <p className="whitespace-pre-line text-[14px]">{app.billing.bankDetails}</p>
                </div>
              ) : null}
              <OnboardingPaymentForm />
            </div>
          ) : null}
        </Section>

        ) : null}

        {/* Back and next: the way through, one step at a time. */}
        <div className="flex items-center justify-between gap-3">
          {prev ? (
            <Link href={`?step=${prev}`} className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-semibold text-v2-ink-2 hover:bg-v2-surface">
              <ArrowLeft size={17} aria-hidden />
              Back
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`?step=${next}`} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-v2-ink px-5 text-[14.5px] font-bold text-v2-bg hover:opacity-90">
              Next: {STEP_LABEL[next]}
              <ArrowRight size={17} aria-hidden />
            </Link>
          ) : null}
        </div>

        {app.notices.length ? (
          <section className="grid gap-3">
            <h2 className="text-[17px] font-bold">Messages from RailServe</h2>
            <ul className="grid gap-2">
              {app.notices.slice(0, 3).map((n, i) => (
                <li key={i} className="rounded-v2-lg border border-v2-line bg-v2-surface px-4 py-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <b className="text-[14.5px]">{n.subject}</b>
                    <span className="text-[12.5px] text-v2-muted">{formatIST(n.at)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[13.5px] text-v2-ink-2">{n.body}</p>
                </li>
              ))}
            </ul>
            {app.notices.length > 3 ? (
              <details className="rounded-v2-lg border border-v2-line bg-v2-surface px-4 py-3">
                <summary className="cursor-pointer text-[14px] font-semibold text-v2-brand">Show {app.notices.length - 3} older message{app.notices.length - 3 === 1 ? '' : 's'}</summary>
                <ul className="mt-2 grid gap-2.5">
                  {app.notices.slice(3).map((n, i) => (
                    <li key={i}>
                      <p className="flex flex-wrap items-baseline justify-between gap-2">
                        <b className="text-[14px]">{n.subject}</b>
                        <span className="text-[12.5px] text-v2-muted">{formatIST(n.at)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-line text-[13px] text-v2-ink-2">{n.body}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        <p className="text-center text-[13px] text-v2-muted">
          Questions? Call us, or{' '}
          <Link href="/login" className="font-semibold text-v2-brand">
            sign in again later
          </Link>{' '}
          to see where things stand.
        </p>
      </div>
    </main>
  )
}

const STATE_WORD: Record<StepState, string> = { done: 'Done', todo: 'To do', waiting: 'Being checked', locked: 'Not yet' }

type StepKey = 'documents' | 'gmail' | 'payment'
const STEPS: StepKey[] = ['documents', 'gmail', 'payment']
const STEP_LABEL: Record<StepKey, string> = { documents: 'Documents', gmail: 'Link Gmail', payment: 'Payment' }
const isStepKey = (v: string): v is StepKey => (STEPS as string[]).includes(v)

/** One step tab: its number (or a tick), its name, and where it stands. The one on screen is outlined. */
function Stepper({ n, label, state, current, href }: { n: number; label: string; state: StepState; current: boolean; href: string }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? 'step' : undefined}
        className={cx(
          'grid h-full gap-1 rounded-v2-lg border px-3 py-2.5 transition-colors',
          current ? 'border-v2-brand bg-v2-surface ring-2 ring-v2-brand-soft' : state === 'done' ? 'border-v2-ok/40 bg-v2-ok-bg hover:border-v2-ok' : 'border-v2-line bg-v2-surface hover:border-v2-line-strong',
        )}
      >
        <span className="flex items-center gap-2 text-[14px] font-bold">
          <StepDot n={n} state={state} />
          <span className="truncate">{label}</span>
        </span>
        <span className={cx('text-[12.5px] font-semibold', state === 'done' ? 'text-v2-ok' : state === 'waiting' ? 'text-v2-warn' : state === 'todo' ? 'text-v2-brand' : 'text-v2-muted')}>{STATE_WORD[state]}</span>
      </Link>
    </li>
  )
}

function StepDot({ n, state }: { n: number; state: StepState }) {
  const base = 'grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold'
  if (state === 'done') return <span className={cx(base, 'bg-v2-ok text-white')}><Check size={14} aria-hidden /></span>
  if (state === 'waiting') return <span className={cx(base, 'bg-v2-warn-bg text-v2-warn')}><Clock size={13} aria-hidden /></span>
  if (state === 'locked') return <span className={cx(base, 'bg-v2-surface-2 text-v2-muted')}><Lock size={12} aria-hidden /></span>
  return <span className={cx(base, 'bg-v2-brand text-white')}>{n}</span>
}

function Section({ n, title, state, icon, summary, children }: { n: number; title: string; state: StepState; icon: React.ReactNode; summary: string; children?: React.ReactNode }) {
  return (
    <section className={cx('grid gap-4 rounded-v2-xl border bg-v2-surface p-5 sm:p-6', state === 'todo' ? 'border-v2-brand/50 shadow-[0_10px_28px_-18px_rgba(16,24,20,0.35)]' : 'border-v2-line', state === 'locked' && 'opacity-70')}>
      <div className="flex items-start gap-3.5">
        <span className={cx('grid size-11 shrink-0 place-items-center rounded-2xl', state === 'done' ? 'bg-v2-ok-bg text-v2-ok' : state === 'locked' ? 'bg-v2-surface-2 text-v2-muted' : 'bg-v2-brand-soft text-v2-brand')}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-v2-muted">Step {n}</p>
          <h2 className="text-[20px] font-bold leading-tight">{title}</h2>
          <p className={cx('mt-1 text-[14.5px]', state === 'done' ? 'text-v2-ok' : 'text-v2-ink-2')}>{summary}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function DocIcon({ status }: { status: string }) {
  const base = 'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full'
  if (status === 'ACCEPTED') return <span className={cx(base, 'bg-v2-ok text-white')}><Check size={16} aria-hidden /></span>
  if (status === 'REJECTED') return <span className={cx(base, 'bg-v2-bad text-white')}><X size={16} aria-hidden /></span>
  if (status === 'PENDING') return <span className={cx(base, 'bg-v2-warn-bg text-v2-warn')}><Clock size={15} aria-hidden /></span>
  return <span className={cx(base, 'border-2 border-dashed border-v2-line-strong text-v2-muted')}><FileText size={14} aria-hidden /></span>
}
