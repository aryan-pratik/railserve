import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { Notice, PageHeader } from '@/components/v2/Table'
import { LayoutBuilder } from '@/components/v2/LayoutBuilder'
import { EMPTY_RULES } from '@/lib/ingest/templates/types'
import { senderAddress } from '@/lib/ingest/senders'
import { loadTeachSample, loadTeachSamples, sourceChoices } from '../../mailActions'

export const metadata = { title: 'Teach a new email layout · RailServe' }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** A new taught layout, from a waiting email (?from=<inbox id>) or one picked here. */
export default async function NewLayoutPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission('company.manage')
  const from = one((await searchParams).from)
  // The list is loaded even with a picked email, for "Use a different email".
  const [picked, sources, samples] = await Promise.all([from ? loadTeachSample(from) : Promise.resolve(null), sourceChoices(), loadTeachSamples()])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-[18px]">
      <Link href="/v2/settings?tab=mail" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-v2-brand hover:underline">
        <ArrowLeft size={15} aria-hidden /> Back to order emails
      </Link>
      <PageHeader title="Teach a new email layout" note="Show RailServe one order email from a new aggregator, and it will read the rest the same way." />
      {from && !picked ? <Notice tone="warn">That email could not be found. Pick another one below.</Notice> : null}
      <LayoutBuilder
        initial={{
          key: null,
          name: '',
          source: 'OTHER',
          senders: senderAddress(picked?.from) ? [senderAddress(picked?.from)!] : [],
          requireVerified: false,
          rules: EMPTY_RULES,
          sample: picked?.body ?? '',
          sampleReceivedAt: picked?.receivedAt ?? null,
        }}
        sources={sources}
        samples={samples}
      />
    </div>
  )
}
