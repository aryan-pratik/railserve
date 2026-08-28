import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { UnparsedInbox } from '../src/lib/models'
import { createOrderFromPaste } from '../src/lib/ingest/paste'
import { ctxFor, makeRestaurant, makeUser, resetDb } from './fixtures'
import type { AuthContext } from '../src/lib/authContext'
import * as fx from './fixtures/yatriRestro'

/**
 * Pasting an order is the fast path for both roles: an aggregator message
 * arrives on someone's phone and they put it straight into the console.
 */
describe('paste-to-create', () => {
  let admin: AuthContext
  let ganga: AuthContext
  let annapurna: AuthContext

  beforeEach(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB', ['GANGA GALAXY'])
    const a = await makeRestaurant('SHREE ANNAPURNA BHOJNALAYA', 'PRYJ', ['SHREE ANNAPURNA'])

    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    ganga = ctxFor(await makeUser('STORE_MANAGER', '9000000002', g._id))
    annapurna = ctxFor(await makeUser('STORE_MANAGER', '9000000003', a._id))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('creates an order an admin pastes', async () => {
    const r = await createOrderFromPaste(admin, fx.SAMPLE_WITH_EMOJI)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.outletName).toBe('HOTEL GANGA GALAXY')
  })

  it('lets a manager paste an order for their own outlet', async () => {
    const r = await createOrderFromPaste(ganga, fx.SAMPLE_WITH_EMOJI)
    expect(r.ok).toBe(true)
  })

  it('refuses a manager an order for a different outlet', async () => {
    const r = await createOrderFromPaste(annapurna, fx.SAMPLE_WITH_EMOJI)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('not one of your outlets')
  })

  it('reports a duplicate instead of creating a second order', async () => {
    await createOrderFromPaste(admin, fx.SAMPLE_WITH_EMOJI)
    const again = await createOrderFromPaste(admin, fx.SAMPLE_WITH_EMOJI)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.detail).toContain('already in the system')
  })

  it('explains an unrecognised paste rather than filing it', async () => {
    const r = await createOrderFromPaste(admin, fx.GARBAGE)
    expect(r.ok).toBe(false)
    // The unparsed inbox is for unattended email. A human pasting gets told.
    expect(await UnparsedInbox.countDocuments({})).toBe(0)
  })

  it('refuses an outlet that matches nothing, without guessing', async () => {
    const r = await createOrderFromPaste(admin, fx.UNKNOWN_OUTLET)
    expect(r.ok).toBe(false)
    expect(await UnparsedInbox.countDocuments({})).toBe(0)
  })

  it('rejects empty input', async () => {
    const r = await createOrderFromPaste(admin, '   ')
    expect(r.ok).toBe(false)
  })

  it('refuses a delivery agent', async () => {
    const agent = ctxFor(await makeUser('DELIVERY_AGENT', '9000000004'))
    const r = await createOrderFromPaste(agent, fx.SAMPLE_WITH_EMOJI)
    expect(r.ok).toBe(false)
  })
})
