import Link from 'next/link'

/** Same switch as the admin Orders toolbar, factored out so the store board can use it too. */
export function GroupByTrainToggle({ href, isGrouped }: { href: string; isGrouped: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${
          isGrouped ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
            isGrouped ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className="text-xs font-medium text-ink group-hover:text-accent transition-colors">
        Group by Train
      </span>
    </Link>
  )
}
