import { PageSkeleton } from '@/components/Skeleton'

/** Payments carries a three-figure summary strip above its table. */
export default function Loading() {
  return <PageSkeleton stats={3} />
}
