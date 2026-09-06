import { PageSkeleton } from '@/components/Skeleton'

/**
 * Shown for every route under /agent while its data loads. App Router picks
 * the nearest loading.tsx, so one file covers the whole section.
 */
export default function Loading() {
  return <PageSkeleton />
}
