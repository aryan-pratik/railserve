import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import mongoose from 'mongoose'

// Two fake Gmail mailboxes stand in for Google: which client was built, and
// which tenant each message was filed under, is all these tests look at.
const calls: { client: string; tenantId: string }[] = []
function fakeGmail(name: string) {
  return {
    users: {
      history: { list: vi.fn(async () => ({ data: { history: [{ messagesAdded: [{ message: { id: `${name}-m1`, labelIds: ['INBOX'] } }] }], historyId: '200' } })) },
      messages: {
        get: vi.fn(async () => ({ data: { labelIds: ['INBOX'], internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'orders@zoopindia.com' }, { name: 'Subject', value: 'Order' }] } } })),
        list: vi.fn(async () => ({ data: { messages: [] } })),
      },
      watch: vi.fn(async () => ({ data: { historyId: '100', expiration: String(Date.now() + 7 * 86_400_000) } })),
      stop: vi.fn(async () => ({})),
    },
  }
}
vi.mock('../src/lib/ingest/gmail/client', async (orig) => {
  const real = await orig<typeof import('../src/lib/ingest/gmail/client')>()
  return {
    ...real,
    isGmailConfigured: () => true,
    gmailClient: () => fakeGmail('server'),
    gmailClientFor: (token: string) => fakeGmail(`linked:${token}`),
  }
})
vi.mock('../src/lib/ingest/index', async (orig) => {
  const real = await orig<typeof import('../src/lib/ingest/index')>()
  return {
    ...real,
    ingestEmail: vi.fn(async (input: { tenantId: mongoose.Types.ObjectId; gmailMessageId?: string }) => {
      calls.push({ client: String(input.gmailMessageId).split('-m1')[0], tenantId: String(input.tenantId) })
      return { status: 'IGNORED', from: null }
    }),
  }
})

import { disconnectDb } from '../src/lib/db'
import { GMAIL_STATE_ID, IngestState, Mailbox, Tenant } from '../src/lib/models'
import { tenantKey } from '../src/lib/tenancy/primary'
import { pushedAddress, syncForPush, syncGmailHistory, syncLinkedMailboxes } from '../src/lib/ingest/gmail/sync'
import { open, seal, sign, verify } from '../src/lib/crypto/secretBox'
import { makeTenant, resetDb, tenantId } from './fixtures'

const push = (email: string) => ({ message: { data: Buffer.from(JSON.stringify({ emailAddress: email, historyId: 123 })).toString('base64') } })

describe('reading a Gmail push', () => {
  it('finds the mailbox address, and nothing in a body it cannot read', () => {
    expect(pushedAddress(push('Orders@Example.com'))).toBe('orders@example.com')
    expect(pushedAddress(null)).toBeNull()
    expect(pushedAddress({ message: { data: 'not base64 json' } })).toBeNull()
  })
})

describe('sealed tokens and signed state', () => {
  it('opens what it sealed, and refuses anything altered', () => {
    const s = seal('refresh-token-123')
    expect(s).not.toContain('refresh-token-123')
    expect(open(s)).toBe('refresh-token-123')
    const parts = s.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => open(parts.join('.'))).toThrow()
  })
  it('accepts its own unexpired state, and nothing forged or expired', () => {
    const v = sign({ t: 'abc' }, 60_000, 1_000)
    expect(verify<{ t: string }>(v, 2_000)?.t).toBe('abc')
    expect(verify(v, 70_000)).toBeNull()
    expect(verify(v.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 2_000)).toBeNull()
  })
})

describe('which mailbox a push reads', () => {
  let other: mongoose.Types.ObjectId
  beforeAll(async () => {
    await resetDb()
    other = (await makeTenant('Other Co'))._id
    for (const t of [tenantId(), other]) {
      await IngestState.create({ _id: await tenantKey(t, GMAIL_STATE_ID), tenantId: t, historyId: '100' })
    }
    await Mailbox.create({ tenantId: other, email: 'orders@otherco.in', tokenSealed: seal('other-token'), linkedAt: new Date() })
  })
  beforeEach(() => {
    calls.length = 0
  })
  afterAll(async () => {
    await disconnectDb()
  })

  it("reads a linked company's Gmail for that company only", async () => {
    const r = await syncForPush(push('orders@otherco.in'))
    expect(r.mailbox).toBe('linked')
    expect(calls).toEqual([{ client: 'linked:other-token', tenantId: String(other) }])
  })

  it('falls back to the server mailbox for any other address, as before', async () => {
    const r = await syncForPush(push('bitestation0001@gmail.com'))
    expect(r.mailbox).toBe('server')
    expect(calls).toEqual([{ client: 'server', tenantId: String(tenantId()) }])
    calls.length = 0
    await syncForPush(null)
    expect(calls).toEqual([{ client: 'server', tenantId: String(tenantId()) }])
  })

  it('does not read a company that is joining or suspended, and never mistakes it for the server mailbox', async () => {
    const joining = (await Tenant.create({ name: 'Joining Co', slug: `joining-${Date.now()}`, status: 'ONBOARDING' }))._id
    await IngestState.create({ _id: await tenantKey(joining, GMAIL_STATE_ID), tenantId: joining, historyId: '100' })
    await Mailbox.create({ tenantId: joining, email: 'orders@joining.in', tokenSealed: seal('joining-token'), linkedAt: new Date() })
    await syncForPush(push('orders@joining.in'))
    expect(calls).toEqual([])
    await syncLinkedMailboxes()
    expect(calls.map((c) => c.client)).not.toContain('linked:joining-token')
    await Tenant.updateOne({ _id: other }, { $set: { status: 'SUSPENDED' } })
    calls.length = 0
    await syncForPush(push('orders@otherco.in'))
    expect(calls).toEqual([])
    await Tenant.updateOne({ _id: other }, { $set: { status: 'ACTIVE' } })
  })

  it('stops reading the server mailbox once the primary company links its own, so nothing is read twice', async () => {
    await Mailbox.create({ tenantId: tenantId(), email: 'kitchen@primary.in', tokenSealed: seal('primary-token'), linkedAt: new Date() })
    await syncGmailHistory()
    expect(calls).toEqual([])
    await syncForPush(push('kitchen@primary.in'))
    expect(calls).toEqual([{ client: 'linked:primary-token', tenantId: String(tenantId()) }])
  })
})
