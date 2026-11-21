'use client'

import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cx, v2Focus } from './ui'
import { THEME_COOKIE, type ThemeChoice } from '@/lib/v2/theme'

export type { ThemeChoice }

function apply(choice: ThemeChoice) {
  document.documentElement.setAttribute('data-theme', choice)
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`
}

/**
 * Light or dark screen, chosen once in Settings (or Your account). Light is the
 * default. The choice is a cookie, so the server draws the right colours on
 * the first paint.
 */
export function ThemeSwitch({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial)
  const items: { value: ThemeChoice; label: string; note: string; Icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', note: 'Best in a bright kitchen or daylight', Icon: Sun },
    { value: 'dark', label: 'Dark', note: 'Easier on the eyes at night', Icon: Moon },
  ]
  return (
    <div role="radiogroup" aria-label="Screen colours" className="grid gap-2 sm:grid-cols-2">
      {items.map(({ value, label, note, Icon }) => {
        const on = choice === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              setChoice(value)
              apply(value)
            }}
            className={cx(
              'flex items-center gap-3 rounded-v2-md border p-4 text-left transition-colors',
              on ? 'border-v2-brand bg-v2-brand-soft' : 'border-v2-line-strong hover:bg-v2-surface-2',
              v2Focus,
            )}
          >
            <Icon size={22} className={on ? 'text-v2-brand' : 'text-v2-muted'} aria-hidden />
            <span>
              <span className="block text-[15px] font-semibold">{label}</span>
              <span className="block text-[13px] text-v2-muted">{note}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
