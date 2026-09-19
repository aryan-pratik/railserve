'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'
import { Modal } from '@/components/Modal'
import { IconPlus } from '@/components/Icons'
import { OutletForm } from './OutletForm'

export function OutletFormModal() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        <IconPlus size={15} />
        New outlet
      </Button>
      {open ? (
        <Modal title="New outlet" titleId="new-outlet-modal" onClose={() => setOpen(false)}>
          <OutletForm onSaved={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
  )
}
