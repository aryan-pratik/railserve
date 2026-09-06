'use client'

import { useEffect } from 'react'
import { Button, ButtonLink, EmptyState } from './ui'

/**
 * What a section shows when its page throws.
 *
 * Next's default is a blank screen with a digest nobody can act on. This
 * keeps the shell, says what happened in one line, and offers the two things
 * that actually help: try the same page again, or go back to the board.
 */
export function ErrorState({
  error,
  reset,
  home,
}: {
  error: Error & { digest?: string }
  reset: () => void
  home: string
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <EmptyState
      title="This screen could not load"
      note="Something went wrong on the server. Trying again usually fixes it. If it keeps happening, tell an admin what you were doing."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={reset}>Try again</Button>
          <ButtonLink href={home}>Back to the board</ButtonLink>
        </div>
      }
    />
  )
}
