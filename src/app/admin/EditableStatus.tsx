'use client'

import { useState } from 'react'
import { StatusBadge, editTriggerClass } from '@/components/ui'
import { StatusEditor } from './orders/AdminOrdersTable'

/**
 * An order's status on the admin board, changeable in place — the same picker
 * the all-orders list uses. The row around it opens the order panel on click,
 * so clicks here stop short of the row.
 */
export function EditableStatus({
  orderId,
  status,
  options,
}: {
  orderId: string
  status: string
  options: string[]
}) {
  const [editing, setEditing] = useState(false)

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <StatusEditor orderId={orderId} current={status} options={options} onDone={() => setEditing(false)} />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={editTriggerClass} title="Click to edit">
          <StatusBadge status={status} />
        </button>
      )}
    </div>
  )
}
