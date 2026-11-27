import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requirePlatformAdmin } from '@/lib/session'
import { applicantOwner, applicationOf } from '@/lib/repo/onboardingRepo'
import { documentSlots } from '@/lib/onboarding'
import { isMailerConfigured } from '@/lib/mailer'
import { formatIST, formatRupees } from '@/lib/format'
import { Card, Chip, Mono } from '@/components/v2/ui'
import { DeclineApplication, DocReview, MarkPaid } from '@/components/v2/PlatformOnboarding'
import { DocPreview } from '@/components/v2/DocPreview'

export const metadata = { title: 'Application · RailServe' }
export const dynamic = 'force-dynamic'

/** One company's application: its documents to check, its payment, and what it has been told. */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin()
  const { id } = await params
  const [app, owner] = await Promise.all([applicationOf(id), applicantOwner(id)])
  const mailer = isMailerConfigured()
  if (!app) notFound()
  const p = app.progress
  const slots = documentSlots(app.documents).map((s) => ({ ...s, fileId: app.documents.find((d) => d.kind === s.kind)?.fileId ?? null }))
  const chip = (state: string) => <Chip tone={state === 'done' ? 'ok' : state === 'waiting' ? 'warn' : state === 'locked' ? 'grey' : 'info'}>{state === 'done' ? 'Done' : state === 'waiting' ? 'To check' : state === 'locked' ? 'Not yet' : 'Waiting on them'}</Chip>

  return (
    <div className="min-h-dvh bg-v2-bg p-4 font-v2 text-v2-ink lg:p-8">
      <div className="mx-auto grid max-w-[1000px] gap-5">
        <Link href="/platform" className="inline-flex w-fit items-center gap-1.5 text-[13.5px] font-semibold text-v2-muted hover:text-v2-brand">
          <ArrowLeft size={16} aria-hidden />
          Platform
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold tracking-[-0.02em]">{app.name}</h1>
            <p className="text-[14px] text-v2-muted">
              Applied {formatIST(app.appliedAt)} · {owner ? `${owner.name}, ` : ''}
              {owner ? <Mono>{owner.phone}</Mono> : null}
              {app.ownerEmail ? ` · ${app.ownerEmail}` : ''}
            </p>
          </div>
          <Chip tone={app.status === 'ACTIVE' ? 'ok' : 'info'}>{app.status === 'ACTIVE' ? 'Let in' : `${p.doneCount} of 3 steps done`}</Chip>
        </div>

        <Card title="Documents" action={chip(p.documents.state === 'waiting' || p.documents.pending ? 'waiting' : p.documents.state)}>
          <ul className="divide-y divide-v2-line">
            {slots.map((d) => (
              <li key={d.kind} className="grid gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                    {d.label}
                    <Chip tone={d.status === 'ACCEPTED' ? 'ok' : d.status === 'REJECTED' ? 'bad' : d.status === 'PENDING' ? 'warn' : 'grey'}>
                      {d.status === 'ACCEPTED' ? 'Accepted' : d.status === 'REJECTED' ? 'Sent back' : d.status === 'PENDING' ? 'To check' : 'Not uploaded'}
                    </Chip>
                  </p>
                  {d.fileId && d.fileName ? (
                    <DocPreview href={`/api/tenant-files/${d.fileId}?tenant=${app.tenantId}`} fileName={d.fileName} title={d.label} className="text-[13.5px] font-semibold">
                      View {d.fileName}
                    </DocPreview>
                  ) : null}
                  {d.uploadedAt ? <span className="ml-2 text-[12.5px] text-v2-muted">uploaded {formatIST(d.uploadedAt)}</span> : null}
                  {d.status === 'REJECTED' && d.reason ? <p className="mt-1 text-[13px] text-v2-bad">Reason given: {d.reason}</p> : null}
                </div>
                <DocReview tenantId={app.tenantId} kind={d.kind} status={d.status} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-5 md:grid-cols-2">
          <Card title="Gmail" action={chip(p.gmail.state === 'todo' ? 'todo' : p.gmail.state)}>
            <p className="text-[14px] text-v2-ink-2">
              {app.gmailLinked ? 'Linked.' : p.gmail.state === 'locked' ? 'Opens for them once every document is accepted.' : 'Waiting for them to link their Gmail.'}
            </p>
          </Card>
          <Card title="Payment" action={chip(p.payment.state)}>
            <div className="grid gap-3 text-[14px]">
              <p>
                Fee: <b>{app.payment.amountPaise != null ? formatRupees(app.payment.amountPaise) : 'not set (set it on Platform)'}</b>
              </p>
              {app.payment.status === 'PAID' ? (
                <p className="font-semibold text-v2-ok">Received {app.payment.paidAt ? formatIST(app.payment.paidAt) : ''}</p>
              ) : (
                <>
                  {app.payment.status === 'CLAIMED' ? (
                    <p>
                      They say they paid: reference <Mono className="font-semibold">{app.payment.reference}</Mono> ({app.payment.claimedAt ? formatIST(app.payment.claimedAt) : ''}). Check your bank, then confirm.
                    </p>
                  ) : (
                    <p className="text-v2-muted">They have not said they paid yet. You can still mark it received if the money arrived.</p>
                  )}
                  <MarkPaid tenantId={app.tenantId} />
                </>
              )}
            </div>
          </Card>
        </div>

        {app.status === 'ONBOARDING' ? (
          <div className="flex justify-end">
            <DeclineApplication tenantId={app.tenantId} name={app.name} />
          </div>
        ) : null}

        <Card title="What they have been told">
          {app.notices.length ? (
            <ul className="grid gap-2.5">
              {app.notices.map((n, i) => (
                <li key={i} className="text-[13.5px]">
                  <b>{n.subject}</b> <span className="text-v2-muted">· {formatIST(n.at)} · {n.emailedAt ? `emailed ${formatIST(n.emailedAt)}` : n.emailError ? `email failed: ${n.emailError}` : mailer ? 'email going out shortly' : 'shown on their screen (sending email is not set up)'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-v2-muted">Nothing yet.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
