'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { BadgeCheck, Pause, Pencil, Play, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import { Button, ButtonLink, Card, Chip, cx, v2Focus } from './ui'
import { Notice } from './Table'
import { checkboxClass, inputClass } from './SettingsForm'
import {
  addSourceSender, deleteTaughtSource, removeSourceSender, setEnforceSenders, setSourceActive, setSourceVerified,
  type MailActionState,
} from '@/app/v2/settings/mailActions'
import type { MailSettings, SourceView } from '@/lib/v2/mailSettings'

/*
 * Settings → Order emails. One card per place orders arrive from, each with
 * the addresses allowed to send them, and one switch that makes the list
 * binding. Written for an owner, not an engineer: no "parser", no "DKIM".
 */

const PUBLIC_MAIL = /@(gmail|googlemail|yahoo|outlook|hotmail|live|rediffmail|icloud|proton|protonmail)\.[a-z.]+$/i

function useAct() {
  const [pending, start] = useTransition()
  const [note, setNote] = useState<MailActionState>({})
  const run = (fn: () => Promise<MailActionState>) => start(async () => setNote(await fn()))
  return { pending, note, run }
}

function Note({ note }: { note: MailActionState }) {
  if (note.error) return <p role="alert" className="text-[13px] font-semibold text-v2-bad">{note.error}</p>
  if (note.ok) return <p role="status" className="text-[13px] font-medium text-v2-ok">{note.ok}</p>
  return null
}

function EnforceSwitch({ on, unlisted }: { on: boolean; unlisted: string[] }) {
  const { pending, note, run } = useAct()
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 max-w-[60ch] gap-1.5">
          <h3 className="flex items-center gap-2 text-[17px] font-bold">
            <ShieldCheck size={18} aria-hidden className={on ? 'text-v2-ok' : 'text-v2-muted'} />
            Only accept orders from listed senders
          </h3>
          <p className="text-[14px] text-v2-muted">
            {on
              ? 'On. An email becomes an order only if it comes from an address listed under its aggregator below. Anything else waits in Emails to check, where you can trust the sender with one tap.'
              : 'Off. Any email that looks like an order becomes one, whoever sent it. Someone who copies an aggregator’s email could send you fake orders. List each aggregator’s address below, then turn this on.'}
          </p>
        </div>
        <Button
          variant={on ? 'secondary' : 'primary'}
          disabled={pending}
          onClick={() => run(() => setEnforceSenders(!on))}
          aria-pressed={on}
        >
          {pending ? 'Saving…' : on ? 'Turn off' : 'Turn on'}
        </Button>
      </div>
      {!on && unlisted.length ? (
        <Notice tone="warn">
          {unlisted.join(', ')} sent you orders in the last 90 days but {unlisted.length === 1 ? 'has' : 'have'} no sender listed yet. If you turn this on first, their orders will wait in Emails to check until you trust them.
        </Notice>
      ) : null}
      <Note note={note} />
    </Card>
  )
}

function SourceCard({ s }: { s: SourceView }) {
  const { pending, note, run } = useAct()
  const [value, setValue] = useState('')
  const kindChip = s.kind === 'TAUGHT' ? <Chip tone="info">You taught it</Chip> : s.kind === 'PAYMENT' ? <Chip tone="grey">Bank alerts</Chip> : null

  return (
    <Card className={cx(!s.active && 'opacity-70')}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-bold">{s.name}</h3>
          {kindChip}
          {!s.active ? <Chip tone="warn">Paused</Chip> : null}
          {s.senders.length === 0 ? <Chip tone={s.recent ? 'warn' : 'grey'}>No sender listed</Chip> : null}
        </div>
        <div className="flex items-center gap-1.5 text-[13px] text-v2-muted">
          {s.recent ? <span>{s.recent.toLocaleString('en-IN')} in 90 days</span> : null}
          {s.kind === 'TAUGHT' ? (
            <>
              <ButtonLink href={`/v2/settings/mail/${encodeURIComponent(s.key)}`} size="sm" variant="ghost" aria-label={`Edit ${s.name}`}>
                <Pencil size={14} aria-hidden /> Edit
              </ButtonLink>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setSourceActive(s.key, !s.active))} aria-label={s.active ? `Pause ${s.name}` : `Turn on ${s.name}`}>
                {s.active ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Delete the layout "${s.name}"? Its emails will wait in Emails to check.`)) run(() => deleteTaughtSource(s.key))
                }}
                aria-label={`Delete ${s.name}`}
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-v2-muted">Emails come from</span>
        {s.senders.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {s.senders.map((x) => (
              <li key={x} className="inline-flex items-center gap-1 rounded-full bg-v2-surface-2 py-1 pl-3 pr-1 font-mono text-[13px] ring-1 ring-inset ring-v2-line">
                {x}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeSourceSender(s.key, x))}
                  aria-label={`Remove ${x}`}
                  className={cx('grid h-6 w-6 place-items-center rounded-full text-v2-muted hover:bg-v2-sunken hover:text-v2-ink', v2Focus)}
                >
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {s.suggestions.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-v2-muted">Seen sending these:</span>
            {s.suggestions.map((g) =>
              PUBLIC_MAIL.test(g.address) ? (
                <span
                  key={g.address}
                  title="A personal mail address, probably a forward. Anyone can use one of these, so it is not offered as a one-tap add."
                  className="inline-flex items-center gap-1 rounded-full bg-v2-warn-bg px-2.5 py-1 font-mono text-[13px] text-v2-ink"
                >
                  {g.address}
                  <span className="font-sans text-v2-muted">· {g.count} · personal address, likely forwarded</span>
                </span>
              ) : (
              <button
                key={g.address}
                type="button"
                disabled={pending}
                onClick={() => run(() => addSourceSender(s.key, g.address))}
                title={g.verified ? `${g.verified} of ${g.count} confirmed genuine by Gmail` : 'Gmail could not confirm these were genuine'}
                className={cx('inline-flex items-center gap-1 rounded-full border border-dashed border-v2-line-strong px-2.5 py-1 font-mono text-[13px] hover:border-v2-brand hover:text-v2-brand', v2Focus)}
              >
                <Plus size={13} aria-hidden />
                {g.address}
                <span className="font-sans text-v2-muted">· {g.count}</span>
                {g.verified ? <BadgeCheck size={13} aria-label="confirmed genuine" className="text-v2-ok" /> : null}
              </button>
              ),
            )}
          </div>
        ) : null}

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const v = value
            run(async () => {
              const r = await addSourceSender(s.key, v)
              if (r.ok) setValue('')
              return r
            })
          }}
        >
          <label className="sr-only" htmlFor={`sender-${s.key}`}>Add a sender for {s.name}</label>
          <input
            id={`sender-${s.key}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="email"
            autoComplete="off"
            placeholder="orders@aggregator.in"
            className={cx(inputClass, 'h-9 w-full font-mono text-[13px] sm:w-72')}
          />
          <Button type="submit" size="sm" disabled={pending || !value.trim()}>Add</Button>
        </form>

        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={s.requireVerified}
            disabled={pending}
            onChange={(e) => {
              const on = e.target.checked
              run(() => setSourceVerified(s.key, on))
            }}
          />
          Only accept mail Gmail confirms is genuine
        </label>
        <Note note={note} />
      </div>
    </Card>
  )
}

export function MailSourcesPanel({ data }: { data: MailSettings }) {
  const builtin = data.sources.filter((s) => s.kind === 'BUILTIN')
  const taught = data.sources.filter((s) => s.kind === 'TAUGHT')
  const payments = data.sources.filter((s) => s.kind === 'PAYMENT')
  // Aggregators that actually send orders, or have senders listed, first.
  const used = builtin.filter((s) => s.recent || s.senders.length || s.suggestions.length)
  const unused = builtin.filter((s) => !(s.recent || s.senders.length || s.suggestions.length))

  return (
    <div className="grid gap-3.5">
      <EnforceSwitch on={data.enforce} unlisted={data.unlisted} />

      <Card
        title="Layouts you taught"
        action={
          <ButtonLink href="/v2/settings/mail/new" size="sm" variant="primary">
            <Plus size={15} aria-hidden /> Teach a new layout
          </ButtonLink>
        }
      >
        <p className="text-[14px] text-v2-muted">
          For an aggregator RailServe does not read yet: open one of its emails, highlight the order number, passenger, dishes and so on, and save. Only mail from the addresses you list is read this way.
        </p>
      </Card>
      {taught.map((s) => <SourceCard key={s.key} s={s} />)}

      <h3 className="mt-2 text-[13px] font-bold uppercase tracking-[0.08em] text-v2-muted">Aggregators</h3>
      {used.map((s) => <SourceCard key={s.key} s={s} />)}
      {unused.length ? (
        <details className="rounded-v2-lg border border-v2-line bg-v2-surface">
          <summary className={cx('cursor-pointer px-[18px] py-3 text-[14px] font-semibold', v2Focus)}>
            {unused.length} more aggregator{unused.length === 1 ? '' : 's'} with no orders lately
          </summary>
          <div className="grid gap-3.5 p-3.5 pt-0">{unused.map((s) => <SourceCard key={s.key} s={s} />)}</div>
        </details>
      ) : null}

      <h3 className="mt-2 text-[13px] font-bold uppercase tracking-[0.08em] text-v2-muted">Payments</h3>
      {payments.map((s) => <SourceCard key={s.key} s={s} />)}

      {data.legacy.length ? (
        <Card title="Older sender list">
          <p className="text-[14px] text-v2-muted">
            Used only while the switch above is off: mail from anyone else is skipped. Once each address is listed under its aggregator, these can go. Remove them under{' '}
            <Link href="/v2/settings?tab=routing" className="font-semibold text-v2-brand underline">Routing</Link>.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {data.legacy.map((x) => (
              <li key={x} className="rounded-full bg-v2-surface-2 px-3 py-1 font-mono text-[13px] ring-1 ring-inset ring-v2-line">{x}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}
