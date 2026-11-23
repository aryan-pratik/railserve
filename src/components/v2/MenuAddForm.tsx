'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { addMenuItem } from '@/app/v2/menu/actions'
import type { MenuState } from '@/app/admin/menu/actions'
import { Button, cx, v2Focus } from './ui'
import { Field, Input, Select } from './AnalyticsField'
import { Notice } from './Table'
import { FloatingPanel, insideFloating } from './Floating'

const initial: MenuState = {}

/**
 * "Add a dish": a button in the page header that opens a small form, for a
 * dish you know is coming before its first order, so that order already
 * prints on the right kitchen ticket.
 */
export function MenuAddForm({ sources }: { sources: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(addMenuItem, initial)
  const anchor = useRef<HTMLSpanElement>(null)
  const getAnchor = useCallback(() => anchor.current, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (anchor.current?.contains(e.target as Node) || insideFloating(e.target)) return
      // The dropdowns draw their lists on the page too; a tap there is not "outside".
      if ((e.target as Element).closest?.('[role="listbox"]')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={anchor} className="inline-flex">
      <Button variant="primary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Plus size={16} aria-hidden /> Add a dish
      </Button>
      {open ? (
        <FloatingPanel getAnchor={getAnchor} align="end" label="Add a dish">
          <div className="grid w-[min(380px,calc(100vw-2rem))] gap-3 rounded-v2-lg border border-v2-line bg-v2-surface p-4 shadow-v2-pop">
            <div className="flex items-center justify-between">
              <b className="text-[16px]">Add a dish</b>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2', v2Focus)}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <p className="-mt-1 text-[13px] text-v2-muted">For a dish that has not been ordered yet. Use the name exactly as the aggregator writes it.</p>
            <form action={action} className="grid gap-3">
              <Field label="Aggregator">
                <Select name="source" defaultValue="" placeholder="Pick one" aria-label="Aggregator" options={sources.map((s) => ({ value: s.id, label: s.label }))} />
              </Field>
              <Field label="Dish name">
                <Input name="name" required maxLength={200} placeholder="e.g. Veg Mini Thali" autoComplete="off" />
              </Field>
              <Field label="Veg or non-veg">
                <Select
                  name="diet"
                  defaultValue=""
                  placeholder="Pick one"
                  aria-label="Veg or non-veg"
                  options={[
                    { value: 'VEG', label: 'Veg' },
                    { value: 'NON_VEG', label: 'Non-veg' },
                  ]}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? 'Adding…' : 'Add dish'}
              </Button>
              {state.error ? <Notice tone="bad">{state.error}</Notice> : state.ok ? <Notice tone="ok">{state.ok}</Notice> : null}
            </form>
          </div>
        </FloatingPanel>
      ) : null}
    </span>
  )
}
