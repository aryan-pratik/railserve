'use client'

import { cx, v2Focus } from './ui'

/**
 * A row of tap-to-pick choices that apply straight away: picking one submits
 * the surrounding filter form. For people who find dropdowns and an "Apply"
 * button confusing, every option is visible and one tap does it.
 */
export function ChoiceChips({
  label,
  name,
  value,
  options,
}: {
  label: string
  name: string
  value: string
  options: { value: string; label: string }[]
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-[14px] font-semibold text-v2-ink">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.value === value
          return (
            <label
              key={o.value || 'all'}
              className={cx(
                'inline-flex h-10 cursor-pointer items-center rounded-full border px-4 text-[14px] font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v2-brand',
                on ? 'border-v2-ink bg-v2-ink text-v2-bg' : 'border-v2-line-strong bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2',
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                defaultChecked={on}
                className={cx('sr-only', v2Focus)}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
