'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Mail, RefreshCw, Unlink } from 'lucide-react'
import { unlinkGmailAction } from '@/app/v2/settings/mailActions'
import { Button, cx } from './ui'

export type GmailCardData = {
  linked: { email: string; linkedAt: string; foundAtLink: number | null; lastError: string | null; lastMessageAgo: string | null } | null
  /** The primary company, reading the Gmail set up on the server. */
  serverMailbox: boolean
  /** What just happened, from the return trip through Google. */
  banner: { tone: 'ok' | 'bad'; text: string } | null
  linkHref: string
  canUnlink: boolean
}

/**
 * "Your Gmail": which Gmail orders are read from, whether it is working, and
 * a careful way to change or unlink it. Changing and unlinking both ask first,
 * naming the Gmail that will stop being read.
 */
export function GmailLinkCard({ data }: { data: GmailCardData }) {
  const [confirm, setConfirm] = useState<'change' | 'unlink' | null>(null)
  const [pending, start] = useTransition()
  const [note, setNote] = useState<string | null>(null)
  const router = useRouter()
  const l = data.linked

  function unlink() {
    start(async () => {
      const r = await unlinkGmailAction()
      setNote(r.ok ?? r.error ?? null)
      setConfirm(null)
      router.refresh()
    })
  }

  return (
    <section className="grid gap-4 rounded-v2-xl border border-v2-line bg-v2-surface p-5 sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className={cx('grid size-11 shrink-0 place-items-center rounded-2xl', l ? 'bg-v2-ok-bg text-v2-ok' : 'bg-v2-brand-soft text-v2-brand')}>
          <Mail size={21} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold">Your Gmail</h2>
          <p className="text-[14px] text-v2-muted">The Gmail where emails from aggregators arrive. RailServe reads those emails and turns them into orders.</p>
        </div>
      </div>

      {data.banner ? (
        <p role="status" className={cx('rounded-v2-md px-4 py-3 text-[14px] font-medium', data.banner.tone === 'ok' ? 'bg-v2-ok-bg text-v2-ok' : 'bg-v2-bad-bg text-v2-bad')}>{data.banner.text}</p>
      ) : null}
      {note ? <p role="status" className="rounded-v2-md bg-v2-surface-2 px-4 py-3 text-[14px]">{note}</p> : null}

      {l ? (
        <div className="grid gap-3 rounded-v2-lg border border-v2-line p-4">
          <p className="text-[13px] font-semibold text-v2-muted">Orders are read from</p>
          <p className="break-all text-[20px] font-bold">{l.email}</p>
          {l.lastError ? (
            <p className="flex gap-2 text-[14px] font-semibold text-v2-bad">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
              {/invalid_grant|revoked|unauthorized/i.test(l.lastError)
                ? 'Google has stopped letting RailServe read this Gmail (the access was removed or the password changed). Press Change Gmail and link it again.'
                : 'Reading this Gmail ran into a problem. It retries every minute; if it keeps happening, link it again.'}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-[14px] font-semibold text-v2-ok">
              <CheckCircle2 size={17} aria-hidden />
              Working{l.lastMessageAgo ? ` · last order email ${l.lastMessageAgo}` : ' · waiting for the next order email'}
            </p>
          )}
          {l.foundAtLink === 0 ? (
            <p className="flex gap-2 rounded-v2-md bg-v2-warn-bg px-3.5 py-2.5 text-[13.5px] text-v2-warn">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <b>Is this the right Gmail?</b> When it was linked, we found no order emails from aggregators in it from the last 30 days. If your orders arrive in a different Gmail, change it now.
              </span>
            </p>
          ) : l.foundAtLink ? (
            <p className="text-[13px] text-v2-muted">When it was linked, {l.foundAtLink >= 100 ? '100+' : l.foundAtLink} order emails from the last 30 days were found in it, so it looks right.</p>
          ) : null}

          {confirm === 'change' ? (
            <div className="grid gap-3 rounded-v2-md border border-v2-brand/40 bg-v2-brand-soft/40 p-4">
              <p className="text-[14px]">
                Orders will <b>stop</b> being read from <b>{l.email}</b>. On the next screen, Google shows your accounts: choose the Gmail that <b>receives your aggregator emails</b>.
              </p>
              <span className="flex flex-wrap gap-2">
                <a href={data.linkHref} className="inline-flex h-10 items-center gap-2 rounded-full bg-v2-brand px-4 text-[14px] font-bold text-white hover:bg-v2-brand-hover">
                  Continue to Google
                </a>
                <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              </span>
            </div>
          ) : confirm === 'unlink' ? (
            <div className="grid gap-3 rounded-v2-md border border-v2-bad/40 bg-v2-bad-bg/50 p-4">
              <p className="text-[14px]">
                Unlink <b>{l.email}</b>? <b>No orders will arrive from email</b> until you link a Gmail again. Orders already in RailServe stay.
              </p>
              <span className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={unlink} disabled={pending}>{pending ? 'Unlinking…' : 'Yes, unlink'}</Button>
                <Button variant="ghost" onClick={() => setConfirm(null)} disabled={pending}>Cancel</Button>
              </span>
            </div>
          ) : (
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setConfirm('change')}>
                <RefreshCw size={15} aria-hidden />
                Change Gmail
              </Button>
              {data.canUnlink ? (
                <Button variant="ghost" onClick={() => setConfirm('unlink')}>
                  <Unlink size={15} aria-hidden />
                  Unlink
                </Button>
              ) : null}
            </span>
          )}
        </div>
      ) : (
        <div className="grid gap-3 rounded-v2-lg border border-v2-line bg-v2-surface-2 p-4">
          {data.serverMailbox ? (
            <p className="text-[14px]">
              <b>Orders are read from the Gmail set up on the server.</b> You only need to link a Gmail here to read a different one instead.
            </p>
          ) : (
            <p className="text-[14px] font-semibold text-v2-bad">No Gmail is linked, so no orders arrive from email.</p>
          )}
          <ul className="grid gap-1.5 text-[14px]">
            <li>• Use the Gmail that <b>receives your aggregator order emails</b>, not a personal one.</li>
            <li>• RailServe only reads order emails. It never sends or deletes your mail.</li>
            <li>• Google will show your accounts and ask you to allow reading emails. Tick the box.</li>
          </ul>
          <a href={data.linkHref} className="inline-flex h-11 w-fit items-center gap-2 rounded-full bg-v2-brand px-5 text-[14.5px] font-bold text-white hover:bg-v2-brand-hover">
            <Mail size={17} aria-hidden />
            Link Gmail
          </a>
        </div>
      )}
    </section>
  )
}
