'use client'

import { useSyncExternalStore } from 'react'
import type { StatusIssue } from './StatusIcon'

/**
 * Problems only the browser can see (this screen stopped updating), reported
 * by the page and shown by the status icon in the top bar. A tiny store so
 * the page does not have to pass anything up through the shell.
 */
const issues = new Map<string, StatusIssue>()
const listeners = new Set<() => void>()
let snapshot: StatusIssue[] = []

function emit() {
  snapshot = [...issues.values()]
  for (const l of listeners) l()
}

export function reportIssue(id: string, issue: Omit<StatusIssue, 'id'> | null) {
  if (issue) issues.set(id, { ...issue, id })
  else if (issues.has(id)) issues.delete(id)
  else return
  emit()
}

const empty: StatusIssue[] = []
export function useReportedIssues(): StatusIssue[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshot,
    () => empty,
  )
}
