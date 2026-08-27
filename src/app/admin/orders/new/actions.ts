'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { createManualOrder } from '@/lib/repo/createOrder'
import { ManualOrderInput } from '@/lib/validation/order'

export type CreateOrderState = {
  error?: string
  fieldErrors?: Record<string, string>
}

export async function createOrderAction(
  _prev: CreateOrderState,
  formData: FormData,
): Promise<CreateOrderState> {
  const ctx = await requireRole('ADMIN')

  const raw = formData.get('payload')
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(String(raw ?? '{}'))
  } catch {
    return { error: 'Could not read the form. Please try again.' }
  }

  const parsed = ManualOrderInput.safeParse(parsedJson)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'form'
      fieldErrors[key] ??= issue.message
    }
    return { error: 'Please fix the highlighted fields.', fieldErrors }
  }

  let id: string
  try {
    const order = await createManualOrder(ctx, parsed.data)
    id = String(order._id)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the order.' }
  }

  revalidatePath('/admin/orders')
  revalidatePath('/store')
  redirect(`/admin/orders/${id}`)
}
