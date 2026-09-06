'use client'

import { ErrorState } from '@/components/ErrorState'

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState {...props} home="/store" />
}
