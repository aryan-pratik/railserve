'use client'

import { useActionState, useState } from 'react'
import { declineApplicationAction, markPaidAction, reviewDocumentAction, saveBillingAction, type PlatformState } from '@/app/platform/actions'
import { Button, cx } from './ui'

const initial: PlatformState = {}

function Note({ state }: { state: PlatformState }) {
  if (state.error) return <p role="alert" className="text-[13px] font-semibold text-v2-bad">{state.error}</p>
  if (state.ok) return <p className="text-[13px] font-semibold text-v2-ok">{state.ok}</p>
  return null
}

/** Accept one document, or send it back with a reason the applicant can act on. */
export function DocReview({ tenantId, kind, status }: { tenantId: string; kind: string; status: string }) {
  const [state, action, pending] = useActionState(reviewDocumentAction, initial)
  const [rejecting, setRejecting] = useState(false)
  if (status === 'MISSING') return <span className="text-[13px] text-v2-muted">Not uploaded yet</span>
  return (
    <form action={action} className="grid justify-items-end gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="kind" value={kind} />
      {rejecting ? (
        <>
          <textarea name="reason" required minLength={5} rows={2} placeholder="What is wrong, and what to upload instead" className="w-72 max-w-full rounded-v2-md border border-v2-line-strong bg-v2-surface px-3 py-2 text-[13.5px] outline-none focus:border-v2-brand" />
          <span className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button type="submit" size="sm" variant="danger" name="decision" value="reject" disabled={pending}>Send back</Button>
          </span>
        </>
      ) : (
        <span className="flex gap-2">
          {status !== 'REJECTED' ? <Button type="button" size="sm" variant="secondary" onClick={() => setRejecting(true)}>Reject</Button> : null}
          {status !== 'ACCEPTED' ? <Button type="submit" size="sm" variant="primary" name="decision" value="accept" disabled={pending}>Accept</Button> : null}
        </span>
      )}
      <Note state={state} />
    </form>
  )
}

/** The joining fee arrived. */
export function MarkPaid({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(markPaidAction, initial)
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <span className="flex flex-wrap gap-2">
        <input name="note" placeholder="Note (optional), e.g. received in HDFC on 27 Nov" className="h-10 min-w-0 flex-1 rounded-full border border-v2-line-strong bg-v2-surface px-3.5 text-[13.5px] outline-none focus:border-v2-brand" />
        <Button type="submit" variant="primary" disabled={pending}>Mark payment received</Button>
      </span>
      <Note state={state} />
    </form>
  )
}

/** What a new company pays, and how. */
export function BillingForm({ fee, upiId, bankDetails }: { fee: string; upiId: string; bankDetails: string }) {
  const [state, action, pending] = useActionState(saveBillingAction, initial)
  const field = 'h-10 w-full rounded-full border border-v2-line-strong bg-v2-surface px-3.5 text-[14px] outline-none focus:border-v2-brand'
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="grid gap-1 text-[13px] font-semibold">
          Joining fee (₹)
          <input name="fee" inputMode="decimal" defaultValue={fee} className={cx(field, 'font-mono')} />
        </label>
        <label className="grid gap-1 text-[13px] font-semibold">
          UPI ID
          <input name="upiId" defaultValue={upiId} placeholder="name@bank" className={cx(field, 'font-mono')} />
        </label>
      </div>
      <label className="grid gap-1 text-[13px] font-semibold">
        Bank details
        <textarea name="bankDetails" defaultValue={bankDetails} rows={3} placeholder={'Account name\nAccount number\nIFSC'} className="rounded-v2-md border border-v2-line-strong bg-v2-surface px-3.5 py-2 text-[14px] outline-none focus:border-v2-brand" />
      </label>
      <span className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>Save</Button>
        <Note state={state} />
      </span>
    </form>
  )
}

/** Turn the application down. Asks for the reason, then once more to be sure. */
export function DeclineApplication({ tenantId, name }: { tenantId: string; name: string }) {
  const [state, action, pending] = useActionState(declineApplicationAction, initial)
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} className="text-v2-bad">
        Decline application
      </Button>
    )
  }
  return (
    <form action={action} className="grid gap-2 rounded-v2-md border border-v2-bad/40 bg-v2-bad-bg/40 p-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <p className="text-[14px]">
        Decline <b>{name}</b>? Their account and documents are removed, and their phone number is freed so they can apply again. They are told the reason.
      </p>
      <textarea name="reason" required minLength={5} rows={2} placeholder="The reason they will be told" className="rounded-v2-md border border-v2-line-strong bg-v2-surface px-3 py-2 text-[13.5px] outline-none focus:border-v2-brand" />
      <span className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>{pending ? 'Declining…' : 'Yes, decline'}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </span>
      <Note state={state} />
    </form>
  )
}
