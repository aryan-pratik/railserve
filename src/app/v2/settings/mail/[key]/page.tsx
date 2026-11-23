import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { PageHeader } from '@/components/v2/Table'
import { LayoutBuilder } from '@/components/v2/LayoutBuilder'
import { EMPTY_RULES, type TemplateRules } from '@/lib/ingest/templates/types'
import { loadLayout, loadTeachSamples, sourceChoices } from '../../mailActions'

export const metadata = { title: 'Edit email layout · RailServe' }

/** The stored rules, made plain (no ObjectIds) and with every default filled. */
function plainRules(stored: unknown): TemplateRules {
  const r = (stored ? JSON.parse(JSON.stringify(stored)) : {}) as Partial<TemplateRules>
  return {
    ...EMPTY_RULES,
    ...r,
    fields: Array.isArray(r.fields) ? r.fields : [],
    items: r.items ?? null,
    fixed: { ...EMPTY_RULES.fixed, ...(r.fixed ?? {}) },
  }
}

export default async function EditLayoutPage({ params }: { params: Promise<{ key: string }> }) {
  await requirePermission('company.manage')
  const { key } = await params
  const layout = await loadLayout(decodeURIComponent(key))
  if (!layout) notFound()
  const [sources, samples] = await Promise.all([sourceChoices(), loadTeachSamples()])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-[18px]">
      <Link href="/v2/settings?tab=mail" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-v2-brand hover:underline">
        <ArrowLeft size={15} aria-hidden /> Back to order emails
      </Link>
      <PageHeader title={layout.name || 'Email layout'} note="Change what this layout reads, then try it and save." />
      <LayoutBuilder
        initial={{
          key: layout.key,
          name: layout.name,
          source: layout.source,
          senders: layout.senders,
          requireVerified: layout.requireVerified,
          rules: plainRules(layout.rules),
          sample: layout.sample,
          sampleReceivedAt: layout.sampleReceivedAt,
        }}
        sources={sources}
        samples={samples}
      />
    </div>
  )
}
