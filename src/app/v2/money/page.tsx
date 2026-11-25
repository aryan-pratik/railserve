import { requirePage, requireRole } from '@/lib/session'
import { loadMoney } from '@/lib/v2/money'
import { formatIST, formatRupees } from '@/lib/format'
import { PageHeader } from '@/components/v2/Table'
import { MoneyTabs } from '@/components/v2/MoneyTabs'
import { MoneyBoard } from '@/components/v2/MoneyBoard'

export const metadata = { title: 'Money · RailServe' }
export const dynamic = 'force-dynamic'

/**
 * Where the cash from cash-on-delivery orders is, for the owner: still with
 * riders, taken by a store manager or team leader, or already handed in.
 */
export default async function V2MoneyPage() {
  const ctx = await requireRole('ADMIN')
  await requirePage('riders')
  const m = await loadMoney(ctx)

  return (
    <div className="grid gap-[18px]">
      <MoneyTabs active="cash" />
      <PageHeader title="Cash" note="Cash paid at the door: first with the rider, then with whoever took it from them, until it reaches you." />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Stat hero label="With riders" value={formatRupees(m.withRidersPaise)} note={`${m.withRidersOrders} order${m.withRidersOrders === 1 ? '' : 's'} · ${m.riders.length} rider${m.riders.length === 1 ? '' : 's'}`} />
        <Stat label="With your staff" value={formatRupees(m.withStaffPaise)} note={m.staff.length ? `${m.staff.length} ${m.staff.length === 1 ? 'person' : 'people'} took it from riders` : 'nobody is holding cash'} />
        <Stat
          label="Short"
          value={formatRupees(m.shortPaise)}
          note={m.shortPaise > 0 ? 'riders said they got less than the bill; still owed' : 'every rider reported the full bill'}
          bad={m.shortPaise > 0}
        />
      </div>

      <MoneyBoard riders={m.riders} staff={m.staff} />

      {m.handIns.length ? (
        <section className="grid gap-2">
          <h2 className="text-[15px] font-bold">Handed to you recently</h2>
          <ul className="divide-y divide-v2-line rounded-v2-lg border border-v2-line bg-v2-surface">
            {m.handIns.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  <b>{h.from}</b> <span className="text-v2-muted">· {formatIST(h.at)} · recorded by {h.by.split(/\s+/)[0]}{h.note ? ` · ${h.note}` : ''}</span>
                </span>
                <span className="font-mono font-semibold tabular-nums">{formatRupees(h.paise)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function Stat({ label, value, note, hero, bad }: { label: string; value: string; note: string; hero?: boolean; bad?: boolean }) {
  return (
    <div className={`grid gap-2 rounded-v2-lg border p-[18px] ${hero ? 'border-v2-brand-deep bg-v2-brand-deep text-white' : bad ? 'border-v2-bad/40 bg-v2-bad-bg' : 'border-v2-line bg-v2-surface'}`}>
      <span className="text-[15px] font-semibold">{label}</span>
      <span className={`font-mono text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums ${bad ? 'text-v2-bad' : ''}`}>{value}</span>
      <span className={`text-[12.5px] ${hero ? 'text-v2-mint' : 'text-v2-muted'}`}>{note}</span>
    </div>
  )
}
