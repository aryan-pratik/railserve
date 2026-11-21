import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { ButtonLink, cx } from './ui'

/*
 * Table and page furniture for v2. Server-rendered; filters and paging are URL
 * state. A table always sits in a TableFrame, which gives it the card edge and
 * the sideways scroll so the page never scrolls horizontally.
 */

export function TableFrame({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('min-w-0 overflow-x-auto rounded-v2-lg border border-v2-line bg-v2-surface', className)}>{children}</div>
}

export function Table({ className, ...rest }: ComponentProps<'table'>) {
  return <table className={cx('w-full border-collapse text-[13.5px]', className)} {...rest} />
}

export function Th({ className, align, ...rest }: ComponentProps<'th'> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cx(
        'relative whitespace-nowrap border-b border-v2-line bg-v2-surface-2 px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-v2-muted first:rounded-tl-v2-lg last:rounded-tr-v2-lg',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...rest}
    />
  )
}

export function Td({ className, align, ...rest }: ComponentProps<'td'> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cx(
        'whitespace-nowrap border-b border-v2-line px-3.5 py-2.5 align-middle group-last/row:border-b-0',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...rest}
    />
  )
}

/** Use on <tr>: hover tint, and `selected` for the brand-soft fill. */
export function rowClass(selected = false, clickable = false) {
  return cx('group/row', clickable && 'cursor-pointer', selected ? 'bg-v2-brand-soft' : 'hover:bg-v2-surface-2')
}

/** Second line under a cell's main text. */
export function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('block text-xs text-v2-faint', className)}>{children}</span>
}

export const PAGE_SIZES = [20, 50, 100] as const

export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
  className,
  sizes = PAGE_SIZES,
}: {
  page: number
  pageSize: number
  total: number
  buildHref: (t: { page: number; pageSize: number }) => string
  className?: string
  /** Page-size choices; short boards (riders) offer smaller ones. */
  sizes?: readonly number[]
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs text-v2-muted', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular-nums">{total === 0 ? 'No results' : `${from}–${to} of ${total.toLocaleString('en-IN')}`}</span>
        <span className="inline-flex rounded-full border border-v2-line p-0.5">
          {sizes.map((s) => (
            <Link
              key={s}
              href={buildHref({ page: 1, pageSize: s })}
              className={cx('rounded-full px-2.5 py-0.5 font-semibold tabular-nums', s === pageSize ? 'bg-v2-ink text-v2-bg' : 'hover:bg-v2-surface-2')}
              aria-current={s === pageSize ? 'true' : undefined}
            >
              {s}
            </Link>
          ))}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <ButtonLink size="sm" href={buildHref({ page: Math.max(1, page - 1), pageSize })} aria-disabled={page <= 1} className={page <= 1 ? 'pointer-events-none opacity-40' : ''}>
          Previous
        </ButtonLink>
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <ButtonLink size="sm" href={buildHref({ page: Math.min(pages, page + 1), pageSize })} aria-disabled={page >= pages} className={page >= pages ? 'pointer-events-none opacity-40' : ''}>
          Next
        </ButtonLink>
      </div>
    </div>
  )
}

export function readPaging(
  sp: Record<string, string | string[] | undefined>,
  sizes: readonly number[] = PAGE_SIZES,
): { page: number; pageSize: number; skip: number } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1)
  const requested = Number.parseInt(one(sp.pageSize), 10)
  const pageSize = sizes.includes(requested) ? requested : sizes[0]
  return { page, pageSize, skip: (page - 1) * pageSize }
}

/** Pill tabs for saved views. `count` renders as a mono badge. */
export function PillTabs({
  tabs,
  className,
}: {
  tabs: { href: string; label: string; count?: number; active?: boolean; tone?: 'bad' }[]
  className?: string
}) {
  return (
    <nav className={cx('flex flex-wrap gap-1.5', className)} aria-label="Views">
      {tabs.map((t) => (
        <Link
          key={t.href + t.label}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
            t.active ? 'border-v2-brand bg-v2-brand text-white' : 'border-v2-line bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2',
          )}
        >
          {t.label}
          {typeof t.count === 'number' ? (
            <span
              className={cx(
                'rounded-md px-1.5 font-mono text-[11px] tabular-nums',
                t.active ? 'bg-white/20 text-white' : t.tone === 'bad' && t.count > 0 ? 'bg-v2-bad-bg text-v2-bad' : 'bg-v2-surface-2 text-v2-muted',
              )}
            >
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

export function EmptyState({ title, note, action, className }: { title: string; note?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('grid place-items-center gap-2 rounded-v2-lg border border-dashed border-v2-line-strong px-6 py-12 text-center', className)}>
      <p className="text-[15px] font-bold">{title}</p>
      {note ? <p className="max-w-[46ch] text-sm text-v2-muted">{note}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; children: ReactNode; className?: string }) {
  const tones = {
    info: 'bg-v2-info-bg text-v2-info',
    ok: 'bg-v2-ok-bg text-v2-ok',
    warn: 'bg-v2-warn-bg text-v2-warn',
    bad: 'bg-v2-bad-bg text-v2-bad',
  }
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-v2-md px-4 py-3 text-sm font-medium', tones[tone], className)}>
      {children}
    </div>
  )
}

export function PageHeader({ title, note, actions, className }: { title: ReactNode; note?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[30px] font-bold tracking-[-0.03em]">{title}</h1>
        {note ? <p className="mt-1 text-sm text-v2-muted">{note}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

/** Label / value pairs in two columns. */
export function KeyValue({ rows, className }: { rows: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13.5px]', className)}>
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-v2-muted">{r.label}</dt>
          <dd className="min-w-0 break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}
