import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cx, v2Focus } from './ui'

/** "← Settings", above a page opened from the Settings home. Admins only: Settings is theirs. */
export function BackToSettings({ role }: { role: string }) {
  if (role !== 'ADMIN') return null
  return (
    <Link href="/v2/settings" className={cx('-mb-2 inline-flex w-fit items-center gap-1.5 rounded-full text-[13.5px] font-semibold text-v2-muted hover:text-v2-brand', v2Focus)}>
      <ArrowLeft size={16} aria-hidden />
      Settings
    </Link>
  )
}
