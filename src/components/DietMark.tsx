import { DIET_LABEL, type Diet, type OrderDiet } from '@/lib/diet'

/**
 * The veg / non-veg mark: a circle for veg, a triangle for non-veg, each in a
 * square outline, the way food packets in India carry it.
 *
 * The shape is the signal, not the colour. On screen it is also green or
 * red; on the KOT (`print`) it is black only, because a thermal head has no
 * colour and renders anything lighter than black as mush.
 */
export function DietMark({
  diet,
  size = 14,
  print = false,
  className = '',
}: {
  /** Null draws the "not tagged yet" mark: a question mark in a dashed square. */
  diet: Diet | null
  size?: number
  print?: boolean
  className?: string
}) {
  const colour = print ? 'text-black' : diet === 'VEG' ? 'text-emerald-700' : diet === 'NON_VEG' ? 'text-red-700' : 'text-amber-700'
  const label = diet ? DIET_LABEL[diet] : 'Not tagged'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      className={`inline-block shrink-0 align-[-0.15em] ${colour} ${className}`}
    >
      <title>{label}</title>
      <rect
        x="1" y="1" width="14" height="14" fill="none" stroke="currentColor"
        strokeWidth={print ? 1.6 : 1.4}
        strokeDasharray={diet ? undefined : '2.5 1.5'}
      />
      {diet === 'VEG' ? <circle cx="8" cy="8" r="4" fill="currentColor" /> : null}
      {diet === 'NON_VEG' ? <path d="M8 3.6 12.6 12H3.4z" fill="currentColor" /> : null}
      {diet === null ? (
        <text x="8" y="12" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="currentColor">?</text>
      ) : null}
    </svg>
  )
}

const ORDER_DIET_TEXT: Record<Exclude<OrderDiet, null>, string> = {
  VEG: 'Veg',
  NON_VEG: 'Non-veg',
  MIXED: 'Veg + non-veg: prints two KOTs',
  UNTAGGED: 'Has an item the menu has no veg / non-veg tag for',
}

/** One order's mark for a board row: both shapes when it carries both. */
export function OrderDietMark({ diet, size = 14 }: { diet: OrderDiet | undefined; size?: number }) {
  if (!diet) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" title={ORDER_DIET_TEXT[diet]}>
      {diet === 'MIXED' ? (
        <>
          <DietMark diet="VEG" size={size} />
          <DietMark diet="NON_VEG" size={size} />
        </>
      ) : (
        <DietMark diet={diet === 'UNTAGGED' ? null : diet} size={size} />
      )}
    </span>
  )
}
