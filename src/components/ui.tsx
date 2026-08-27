import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {action}
    </div>
  )
}

export function Field({
  label, htmlFor, error, hint, children,
}: {
  label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ' +
  'focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50'

const STATUS_STYLES: Record<string, string> = {
  ENQUIRY: 'bg-slate-100 text-slate-700 ring-slate-200',
  QUOTED: 'bg-sky-100 text-sky-800 ring-sky-200',
  RECEIVED: 'bg-blue-100 text-blue-800 ring-blue-200',
  ACCEPTED: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  KOT_PRINTED: 'bg-violet-100 text-violet-800 ring-violet-200',
  PREPARED: 'bg-amber-100 text-amber-800 ring-amber-200',
  DISPATCHED: 'bg-orange-100 text-orange-800 ring-orange-200',
  DELIVERED: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  FAILED: 'bg-red-100 text-red-800 ring-red-200',
  CANCELLED: 'bg-slate-200 text-slate-600 ring-slate-300',
  LOST: 'bg-slate-200 text-slate-600 ring-slate-300',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
      }`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

export function TypeBadge({ type }: { type: string }) {
  const bulk = type === 'BULK'
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide ring-1 ring-inset ${
        bulk
          ? 'bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200'
          : 'bg-slate-100 text-slate-600 ring-slate-200'
      }`}
    >
      {type}
    </span>
  )
}

export function EmptyState({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{note}</p>
    </div>
  )
}
