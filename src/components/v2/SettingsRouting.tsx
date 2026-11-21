'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button, cx, v2Focus } from './ui'
import { Notice } from './Table'
import { FormNote, checkboxClass, inputClass } from './SettingsForm'
import { Select } from './Select'
import { addSender, removeSender, routeListing, setStationKitchen, type ListingState, type SenderState } from '@/app/v2/settings/actions'

/*
 * The controls on Settings → Routing. Each is "pick, then Save appears":
 * a screen of twelve storefronts should not show twelve identical buttons.
 */

/** The compact square dropdown the inline controls use. */
const inlineSelectButton = 'h-9 rounded-v2-md border-v2-line-strong text-[13px]'

export function SenderAllowlist({ senders }: { senders: string[] }) {
  const [state, formAction, pending] = useActionState<SenderState, FormData>(addSender, {})
  const inputRef = useRef<HTMLInputElement>(null)

  // Clear the box after a successful add, so the next address starts fresh.
  useEffect(() => {
    if (state.ok && inputRef.current) inputRef.current.value = ''
  }, [state])

  return (
    <div className="grid gap-3">
      {senders.length === 0 ? (
        <Notice tone="warn">
          The list is empty, so mail from every sender is parsed. Anything that is not an order lands in the Inbox. Add the addresses aggregators send from and only their mail will be read; bank alerts are always read.
        </Notice>
      ) : (
        <p className="text-sm text-v2-muted">
          Only mail from these senders is parsed into orders. Mail from anyone else is skipped and does not reach the Inbox. Bank payment alerts are always read, whatever this list says.
        </p>
      )}

      {senders.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {senders.map((s) => (
            <li key={s} className="inline-flex items-center gap-1 rounded-full bg-v2-surface-2 py-0.5 pl-2.5 pr-1 font-mono text-xs text-v2-ink ring-1 ring-inset ring-v2-line">
              {s}
              <form action={removeSender}>
                <input type="hidden" name="sender" value={s} />
                <button type="submit" aria-label={`Remove ${s}`} title="Remove" className={cx('grid h-5 w-5 place-items-center rounded-full text-v2-muted hover:bg-v2-sunken hover:text-v2-ink', v2Focus)}>
                  <X size={12} aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <label htmlFor="allowed-sender" className="sr-only">
          Sender email address or domain
        </label>
        <input
          ref={inputRef}
          id="allowed-sender"
          name="sender"
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder="orders@zoop.in or @zoop.in"
          className={cx(inputClass, 'h-9 w-full font-mono text-[13px] sm:w-80')}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Adding…' : 'Add sender'}
        </Button>
        <FormNote state={state} />
      </form>
    </div>
  )
}

/**
 * "Cooked by" for one storefront. "Move past orders too" is off by default
 * and present on purpose: re-pointing means either "this was mapped wrongly,
 * fix the history" or "from Monday this brand moves kitchen, leave the books
 * alone", and only the person knows which.
 */
export function ListingRoute({
  listing,
  outlets,
  stationDefaultName,
}: {
  listing: { id: string; name: string; source: string | null; restaurantId: string | null; orderCount: number }
  /** Only the active kitchens at this listing's own station. */
  outlets: { id: string; name: string }[]
  stationDefaultName: string | null
}) {
  const [state, action, pending] = useActionState<ListingState, FormData>(routeListing, {})
  const [choice, setChoice] = useState(listing.restaurantId ?? '')
  const changed = choice !== (listing.restaurantId ?? '')

  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="listingId" value={listing.id} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`route-${listing.id}`}>
          Kitchen for {listing.name}
        </label>
        <Select
          id={`route-${listing.id}`}
          name="restaurantId"
          value={choice}
          onChange={setChoice}
          size="sm"
          className="min-w-[12rem]"
          buttonClassName={inlineSelectButton}
          options={[
            { value: '', label: stationDefaultName ? `Station default · ${stationDefaultName}` : 'Station default · none set' },
            ...outlets.map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
        {changed ? (
          <>
            {listing.source ? (
              <label className="inline-flex items-center gap-1.5 text-xs text-v2-muted">
                <input type="checkbox" name="moveExisting" className={checkboxClass} />
                Move {listing.orderCount > 0 ? `${listing.orderCount} past order${listing.orderCount === 1 ? '' : 's'}` : 'past orders'} too
              </label>
            ) : null}
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : null}
      </div>
      <FormNote state={state} />
    </form>
  )
}

/** The kitchen a station falls back to for a storefront nobody has mapped. */
export function StationKitchenSelect({
  stationCode,
  current,
  outlets,
  compact,
}: {
  stationCode: string
  current: string | null
  outlets: { id: string; name: string }[]
  compact?: boolean
}) {
  const [choice, setChoice] = useState(current ?? '')
  const changed = choice !== (current ?? '')

  return (
    <form action={setStationKitchen} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="stationCode" value={stationCode} />
      <label htmlFor={`default-${stationCode}-${compact ? 'c' : 'f'}`} className={cx('text-xs font-semibold text-v2-muted', compact && 'sr-only')}>
        Unmapped storefronts at <span className="font-mono text-v2-ink">{stationCode}</span> go to
      </label>
      <Select
        id={`default-${stationCode}-${compact ? 'c' : 'f'}`}
        name="restaurantId"
        value={choice}
        onChange={setChoice}
        size="sm"
        className="min-w-[12rem]"
        buttonClassName={inlineSelectButton}
        options={[{ value: '', label: compact ? 'No default kitchen' : 'Nothing · hold them in the Inbox' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]}
      />
      {changed ? (
        <Button type="submit" size="sm" variant="primary">
          Save
        </Button>
      ) : null}
    </form>
  )
}
