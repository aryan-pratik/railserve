import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { cookies } from 'next/headers'
import { THEME_COOKIE } from '@/lib/v2/theme'

/*
 * Three faces, chosen for what this app actually shows.
 *
 * Inter carries the current UI: it stays legible at the 12–13px this board
 * runs at, and its tabular figures keep columns of times, seat numbers and
 * amounts aligned. It also sets the printed KOT (--font-kot in globals.css),
 * which depends on Inter's zero being a plain open oval — see KotTicket.tsx
 * before swapping it.
 *
 * JetBrains Mono carries train numbers and seat codes on screen. Its zero is
 * slashed and its 1/l/I are unmistakable. It is not used on the KOT: a thermal
 * head fills the mark in and the 0 reads as an 8.
 *
 * Plus Jakarta Sans carries the v2 screens (/v2). Rounded geometric, with
 * tabular figures for the big dashboard numbers. It replaces Inter screen by
 * screen as the rebuild lands.
 *
 * To change any of them, change it here; nothing else names a typeface.
 */
const sans = Inter({
  variable: '--font-sans-face',
  subsets: ['latin'],
  display: 'swap',
})

const mono = JetBrains_Mono({
  variable: '--font-mono-face',
  subsets: ['latin'],
  display: 'swap',
})

const v2 = Plus_Jakarta_Sans({
  variable: '--font-v2-face',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'RailServe',
  description: 'Train food delivery order tracking',
}

// Runs before paint: with no explicit choice, follow the OS so a dark-mode
// user never sees a light flash. The v2 shell's ThemeSwitch writes the cookie.
const THEME_BOOT = `(function(){try{var m=document.cookie.match(/(?:^|; )rs_theme=(light|dark)/);var t=m?m[1]:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const choice = (await cookies()).get(THEME_COOKIE)?.value
  const theme = choice === 'dark' || choice === 'light' ? choice : undefined
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${v2.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
