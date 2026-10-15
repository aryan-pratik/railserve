import { describe, expect, it } from 'vitest'
import { isOutgoing } from '../src/lib/ingest/gmail/sync'

describe('isOutgoing — mail the mailbox wrote is never an incoming order', () => {
  it('skips sent mail and drafts', () => {
    expect(isOutgoing(['SENT'])).toBe(true)
    expect(isOutgoing(['DRAFT'])).toBe(true)
    // A reply staff sent that Gmail also threads into the inbox.
    expect(isOutgoing(['SENT', 'INBOX', 'IMPORTANT'])).toBe(true)
  })

  it('keeps everything that arrived', () => {
    expect(isOutgoing(['UNREAD', 'CATEGORY_UPDATES', 'INBOX'])).toBe(false)
    expect(isOutgoing(['SPAM'])).toBe(false)
    expect(isOutgoing([])).toBe(false)
    expect(isOutgoing(undefined)).toBe(false)
  })
})
