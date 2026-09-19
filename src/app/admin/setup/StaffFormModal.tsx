'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { Modal } from '@/components/Modal'
import { IconPlus } from '@/components/Icons'
import { StaffForm, type StaffValues } from './StaffForm'
import type { OutletOption } from './OutletMultiSelect'

/**
 * One modal for both "add staff" (button-triggered, local state) and "edit
 * staff" (triggered by the row's Edit link via `?edit=<id>`, so it stays
 * deep-linkable). `key={editId ?? 'new'}` at the call site remounts this on
 * every switch between add/edit/a different row, which is what lets `open`'s
 * initial value track the server-derived edit target for free.
 */
export function StaffFormModal({
  outlets, values, editId,
}: {
  outlets: OutletOption[]
  values?: StaffValues
  editId?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(Boolean(editId))

  const close = () => {
    setOpen(false)
    if (editId) router.push('/admin/setup?tab=staff')
  }

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        <IconPlus size={15} />
        Add staff
      </Button>
      {open ? (
        <Modal title={values?.id ? 'Edit staff' : 'Add staff'} titleId="staff-form-modal" onClose={close} maxWidthClassName="max-w-3xl">
          <StaffForm outlets={outlets} values={values} onSaved={close} />
        </Modal>
      ) : null}
    </>
  )
}
