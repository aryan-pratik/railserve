import { formatIST, formatMoney } from '@/lib/format'
import { getProofStore } from '@/lib/storage'
import { Card, CardHeader } from './ui'

type Maybe<T> = T | null | undefined

/**
 * What actually happened at the train door.
 *
 * The photo is fetched through a short-lived signed URL generated per render
 * rather than stored on the order — a URL saved in the database would be dead
 * within the hour, and making the bucket public to avoid that would put every
 * passenger's doorstep photo on the open internet.
 */
export async function DeliveryProof({
  delivery,
  riders,
}: {
  delivery: {
    proofType?: Maybe<string>
    proofValue?: Maybe<string>
    deliveredAt?: Maybe<Date>
    dispatchedAt?: Maybe<Date>
    amountCollectedPaise?: Maybe<number>
    failureReason?: Maybe<string>
  }
  riders: string[]
}) {
  const hasAnything =
    delivery.deliveredAt || delivery.dispatchedAt || delivery.failureReason || delivery.proofValue
  if (!hasAnything) return null

  let photoUrl: string | null = null
  if (delivery.proofType === 'PHOTO' && delivery.proofValue) {
    try {
      photoUrl = await getProofStore().presignDownload(delivery.proofValue)
    } catch {
      // A missing bucket must not take the whole order page down; the rest of
      // the delivery record is still worth showing.
      photoUrl = null
    }
  }

  return (
    <Card>
      <CardHeader title="Delivery" />
      <div className="space-y-3 p-4 text-sm">
        {photoUrl ? (
          <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL on an external bucket, expires; not an optimisable static asset */}
            <img
              src={photoUrl}
              alt="Photo taken at handover"
              className="max-h-72 w-full rounded-lg border border-line object-contain bg-sunken"
            />
          </a>
        ) : delivery.proofType === 'PHOTO' && delivery.proofValue ? (
          <p className="text-xs text-muted">
            A photo is on file but cannot be shown — proof storage is unavailable.
          </p>
        ) : null}

        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {riders.length > 0 ? (
            <Row label="Delivered by" value={riders.join(', ')} />
          ) : null}
          {delivery.dispatchedAt ? (
            <Row label="Left the kitchen" value={formatIST(delivery.dispatchedAt)} />
          ) : null}
          {delivery.deliveredAt ? (
            <Row label="Handed over" value={formatIST(delivery.deliveredAt)} />
          ) : null}
          {delivery.proofType === 'SIGNATURE' && delivery.proofValue ? (
            <Row label="Received by" value={delivery.proofValue} />
          ) : null}
          {delivery.amountCollectedPaise != null ? (
            <Row label="Cash collected" value={formatMoney(delivery.amountCollectedPaise)} />
          ) : null}
        </dl>

        {delivery.failureReason ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-inset ring-red-200">
            Not delivered — {delivery.failureReason}
          </p>
        ) : null}
      </div>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-ink sm:mt-0.5">{value}</dd>
    </div>
  )
}
