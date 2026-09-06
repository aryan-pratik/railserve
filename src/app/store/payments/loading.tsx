import { PageSkeleton } from '@/components/Skeleton'

/** A store manager sees two figures, not three — the balance is admin-only. */
export default function Loading() {
  return <PageSkeleton stats={2} />
}
