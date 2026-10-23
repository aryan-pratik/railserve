import { PageSkeleton } from '@/components/Skeleton'

/**
 * Its own, so a rider's record does not load under the parent's map-and-
 * roster skeleton: a header, five figures, then the orders.
 */
export default function Loading() {
  return <PageSkeleton stats={5} />
}
