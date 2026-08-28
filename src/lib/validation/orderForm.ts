import { ManualOrderInput } from './order'

/**
 * Reads the manual-order form off FormData.
 *
 * Item rows post as parallel `itemName` / `itemQty` / `itemPrice` arrays rather
 * than indexed field names, so the client can add and remove rows without
 * renumbering anything. Rows with no name are dropped — an empty trailing row
 * is a normal thing to leave behind, not an error to report.
 *
 * Blank strings become undefined so the schema's optional fields stay optional;
 * an empty <input> otherwise reads as a deliberate empty value.
 */
function text(formData: FormData, key: string): string | undefined {
  const v = formData.get(key)
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function manualOrderFromFormData(formData: FormData) {
  const names = formData.getAll('itemName').map(String)
  const qtys = formData.getAll('itemQty').map(String)
  const prices = formData.getAll('itemPrice').map(String)

  const items = names
    .map((name, i) => ({
      name: name.trim(),
      qty: Number(qtys[i] ?? '1') || 1,
      priceRupees: prices[i]?.trim() || undefined,
      isPacking: false,
    }))
    .filter((i) => i.name.length > 0)

  const pax = text(formData, 'pax')

  return ManualOrderInput.safeParse({
    orderType: formData.get('orderType') ?? 'RETAIL',
    restaurantId: formData.get('restaurantId') ?? '',
    serviceDate: formData.get('serviceDate') ?? '',

    trainNo: text(formData, 'trainNo'),
    trainName: text(formData, 'trainName'),
    scheduledArrival: text(formData, 'scheduledArrival'),

    coach: text(formData, 'coach'),
    berth: text(formData, 'berth'),
    handoverPoint: text(formData, 'handoverPoint'),

    contactName: text(formData, 'contactName'),
    contactPhone: text(formData, 'contactPhone'),

    pax: pax ? Number(pax) : undefined,
    amountRupees: text(formData, 'amountRupees'),
    paymentMode: text(formData, 'paymentMode'),
    readyBy: text(formData, 'readyBy'),
    notes: text(formData, 'notes'),

    items,
    menuSpec: text(formData, 'menuSpec'),
    packingItems: formData.getAll('packingItems').map(String).filter(Boolean),
  })
}
