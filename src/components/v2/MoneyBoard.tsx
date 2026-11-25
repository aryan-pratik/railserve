'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HandCoins } from 'lucide-react'
import { recordHandInV2, type FormState } from '@/app/v2/riders/actions'
import type { RiderOwing } from '@/lib/v2/money'
import type { StaffCash } from '@/lib/repo/riderCashRepo'
import { formatIST, formatRupees } from '@/lib/format'
import { EmptyState, Sub, Table, TableFrame, Td, Th, rowClass } from './Table'
import { Button, Chip, Mono, cx, v2Focus } from './ui'
import { RiderCashDialog } from './RiderCashDialog'
import { RiderDialog, RiderFormNote } from './RiderDialog'

const initial: FormState = {}

/** The two lists on the owner's cash page, with Collect and Received. */
export function MoneyBoard({ riders, staff }: { riders: RiderOwing[]; staff: StaffCash[] }) {
  const router = useRouter()
  const [collect, setCollect] = useState<RiderOwing | null>(null)
  const [handIn, setHandIn] = useState<StaffCash | null>(null)

  return (
    <>
      <section className="grid gap-2">
        <h2 className="text-[15px] font-bold">Riders who owe cash</h2>
        {riders.length === 0 ? (
          <EmptyState title="No rider owes cash" note="Every cash order delivered has been handed in." />
        ) : (
          <TableFrame>
            <Table>
              <thead>
                <tr>
                  <Th>Rider</Th>
                  <Th align="right">Owes</Th>
                  <Th>Since</Th>
                  <Th className="w-full" />
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => (
                  <tr key={r.id} className={rowClass()}>
                    <Td>
                      <Link href={`/v2/riders/${r.id}`} className={cx('font-bold hover:underline', v2Focus)}>
                        {r.name}
                      </Link>
                      {r.isTeamLead ? <Chip tone="info" className="ml-1.5">Lead</Chip> : null}
                      <Sub>
                        {r.dueOrders.length} order{r.dueOrders.length === 1 ? '' : 's'}
                      </Sub>
                    </Td>
                    <Td align="right">
                      <Mono className="font-semibold text-v2-cod">{formatRupees(r.owedPaise)}</Mono>
                      {r.shortPaise > 0 ? <Sub className="font-semibold text-v2-bad">{formatRupees(r.shortPaise)} short</Sub> : null}
                    </Td>
                    <Td>
                      <span className="whitespace-nowrap">{r.oldestAt ? formatIST(r.oldestAt) : '—'}</span>
                    </Td>
                    <Td align="right">
                      <Button size="sm" variant="soft" onClick={() => setCollect(r)} aria-label={`Collect ${formatRupees(r.owedPaise)} from ${r.name}`}>
                        <HandCoins size={14} strokeWidth={2} aria-hidden />
                        Collect
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableFrame>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="text-[15px] font-bold">Staff holding cash</h2>
        {staff.length === 0 ? (
          <EmptyState title="Nobody is holding cash" note="When a store manager or team leader takes cash from a rider, it shows here until they hand it to you." />
        ) : (
          <TableFrame>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th align="right">Holding</Th>
                  <Th>Last took cash</Th>
                  <Th className="w-full" />
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.userId} className={rowClass()}>
                    <Td>
                      <b className="font-bold">{s.name}</b>
                      <Sub>{s.label}</Sub>
                    </Td>
                    <Td align="right">
                      <Mono className="font-semibold">{formatRupees(s.holdingPaise)}</Mono>
                      <Sub>
                        took {formatRupees(s.receivedPaise)} · gave you {formatRupees(s.handedInPaise)}
                      </Sub>
                    </Td>
                    <Td>
                      <span className="whitespace-nowrap">{s.lastReceivedAt ? formatIST(s.lastReceivedAt) : '—'}</span>
                    </Td>
                    <Td align="right">
                      <Button size="sm" variant="soft" onClick={() => setHandIn(s)}>
                        <HandCoins size={14} strokeWidth={2} aria-hidden />
                        Received
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableFrame>
        )}
      </section>

      {collect ? (
        <RiderCashDialog rider={collect} orders={collect.dueOrders} onClose={() => { setCollect(null); router.refresh() }} onSettled={() => router.refresh()} />
      ) : null}
      {handIn ? <HandInDialog person={handIn} onClose={() => { setHandIn(null); router.refresh() }} /> : null}
    </>
  )
}

/** The owner takes cash from a store manager or team leader. */
function HandInDialog({ person, onClose }: { person: StaffCash; onClose: () => void }) {
  const [state, action, pending] = useActionState(recordHandInV2, initial)
  const [rupees, setRupees] = useState(String(Math.round(person.holdingPaise / 100)))
  const router = useRouter()
  const first = person.name.split(/\s+/)[0]
  const paise = Math.round((Number(rupees) || 0) * 100)
  const valid = paise > 0 && paise <= person.holdingPaise
  useEffect(() => {
    if (state.ok) router.refresh()
  }, [state.ok, router])

  return (
    <RiderDialog
      title={`Cash from ${first}`}
      titleId="hand-in-dialog"
      note={`${first} is holding ${formatRupees(person.holdingPaise)} taken from riders.`}
      onClose={onClose}
      footer={
        state.ok ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <form action={action} className="flex flex-wrap items-center justify-end gap-2">
            <input type="hidden" name="fromUserId" value={person.userId} />
            <input type="hidden" name="rupees" value={rupees} />
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || pending}>
              {pending ? 'Saving…' : `Yes, I have ${valid ? formatRupees(paise) : '…'}`}
            </Button>
          </form>
        )
      }
    >
      {state.ok ? (
        <RiderFormNote state={state} />
      ) : (
        <div className="grid gap-1.5">
          <label htmlFor="hand-in-amount" className="text-[12.5px] font-semibold text-v2-ink-2">
            Amount you received
          </label>
          <span className="relative w-fit">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-v2-muted">₹</span>
            <input
              id="hand-in-amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={Math.round(person.holdingPaise / 100)}
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              className="h-11 w-40 rounded-full border border-v2-line-strong bg-v2-surface pl-8 pr-3.5 font-mono text-[18px] font-bold tabular-nums outline-none focus:border-v2-brand focus:ring-[3px] focus:ring-v2-brand-soft"
            />
          </span>
          <span className="text-xs text-v2-muted">Count the notes first. Type less if {first} is giving you part of it; the rest stays with them.</span>
          <RiderFormNote state={state} />
        </div>
      )}
    </RiderDialog>
  )
}
