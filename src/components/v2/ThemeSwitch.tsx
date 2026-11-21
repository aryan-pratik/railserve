'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import { cx, v2Focus } from './ui'

import { THEME_COOKIE, type ThemeChoice } from '@/lib/v2/theme'

export type { ThemeChoice }

/** Applies a choice to <html>: an explicit theme sets data-theme, system follows the OS. */
function persist(choice: ThemeChoice) {
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.setAttribute('data-theme', dark ? 'dark' : 'light')
    root.dataset.themeChoice = 'system'
  } else {
    root.setAttribute('data-theme', choice)
    root.dataset.themeChoice = choice
  }
}

/**
 * Light / dark / system. The choice lives in a cookie so the server can set
 * `data-theme` on the first paint (no flash), and in the OS when "system" is
 * picked, which this component keeps following while the page is open.
 */
export function ThemeSwitch({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial)

  useEffect(() => {
    if (choice !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])

  function pick(next: ThemeChoice) {
    setChoice(next)
    apply(next)
    persist(next)
  }

  const items: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'dark', label: 'Dark', Icon: Moon },
    { value: 'system', label: 'Follow system', Icon: Monitor },
  ]

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full border border-v2-line bg-v2-surface p-0.5">
      {items.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          onClick={() => pick(value)}
          className={cx(
            'grid h-8 w-8 place-items-center rounded-full transition-colors',
            choice === value ? 'bg-v2-ink text-v2-bg' : 'text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink',
            v2Focus,
          )}
        >
          <Icon size={15} strokeWidth={1.9} aria-hidden />
        </button>
      ))}
    </div>
  )
}
