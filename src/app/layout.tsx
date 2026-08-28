import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/*
 * Two faces, chosen for what this app actually shows.
 *
 * Inter carries the UI: it stays legible at the 12–13px this board runs at, and
 * its tabular figures keep columns of times, seat numbers and amounts aligned.
 *
 * JetBrains Mono carries train numbers, seat codes and the KOT. Its zero is
 * slashed and its 1/l/I are unmistakable — on an 80mm thermal ticket read at
 * arm's length over a kitchen pass, that is a correctness feature, not a style.
 *
 * To change either, change it here; nothing else names a typeface.
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

export const metadata: Metadata = {
  title: 'RailServe',
  description: 'Train food delivery order tracking',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
