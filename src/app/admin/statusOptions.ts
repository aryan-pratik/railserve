import { allowedNextStatuses, type OrderStatus } from '@/lib/orderStatus'
import { statusLabel } from '@/components/ui'

/**
 * Single source for the admin's next-status buttons — used by both the
 * board's OrderModal (via orderDetail.ts) and the full order detail page
 * (admin/orders/[id]/page.tsx). They used to compute this independently and
 * drifted: one fell back to the raw enum string ("MISDELIVERY") while the
 * other used `statusLabel`, so the same order showed different button text
 * depending on which screen it was opened from.
 *
 * Outcomes that end the order early are red, the same way Cancel always
 * has been; everything else is the ordinary next step.
 */
const DANGER_STATUSES: readonly OrderStatus[] = [
  'CANCELLED',
  'FAILED',
  'LOST',
  'MISDELIVERY',
  'MISSED_DELIVERY',
  'REFUNDED',
]

export type AdminStatusOption = { to: OrderStatus; label: string; danger: boolean }

export function adminNextStatusOptions(status: OrderStatus): AdminStatusOption[] {
  return allowedNextStatuses(status, 'ADMIN').map((to) => ({
    to,
    // Plain status names, not verbs: "Cancel" not "Mark cancelled".
    label: to === 'CANCELLED' ? 'Cancel' : statusLabel(to),
    danger: DANGER_STATUSES.includes(to),
  }))
}
