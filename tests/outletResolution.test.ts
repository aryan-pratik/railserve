import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { Listing, Restaurant, Station } from '../src/lib/models'
import { matchOutlet } from '../src/lib/ingest/outletMatch'
import { makeRestaurant, resetDb, tenantId } from './fixtures'

/**
 * The thing this whole model change was for: an aggregator's storefront name
 * has to reach the kitchen that cooks it, and one aggregator names several
 * different kitchens of ours.
 */
describe('resolving the outlet name in an aggregator mail', () => {
  let ganga: mongoose.Types.ObjectId
  let cosmozin: mongoose.Types.ObjectId

  beforeEach(async () => {
    await resetDb()
    await Listing.deleteMany({ tenantId: tenantId() })
    await Station.deleteMany({ tenantId: tenantId() })

    ganga = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB', ['GANGA GALAXY']))._id
    cosmozin = (await makeRestaurant('THE COSMOZIN LOUNGE', 'CNB'))._id
    await Station.create({ tenantId: tenantId(), _id: 'CNB', name: 'Kanpur Central', defaultRestaurantId: ganga })
  })

  it('routes a mail that names one of our kitchens straight to it', async () => {
    // YatriRestro writes "HOTEL GANGA GALAXY" in its own mail; nothing to infer.
    const m = await matchOutlet(tenantId(), 'HOTEL GANGA GALAXY', 'CNB')
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.restaurantId).toBe(String(ganga))
    expect(m.via).toBe('outlet')
  })

  it('still matches one of our kitchens by alias, and ignores case and spacing', async () => {
    const m = await matchOutlet(tenantId(), '  ganga   galaxy ', 'CNB')
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.restaurantId).toBe(String(ganga))
  })

  it('routes a mapped storefront to the kitchen behind it', async () => {
    await Listing.create({ tenantId: tenantId(),
      name: 'YATRI BHOJAN', source: 'YATRIBHOJAN', stationCode: 'CNB', restaurantId: cosmozin,
    })
    const m = await matchOutlet(tenantId(), 'Yatri Bhojan', 'CNB')
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.restaurantId).toBe(String(cosmozin))
    expect(m.via).toBe('listing')
    expect(m.listingName).toBe('YATRI BHOJAN')
  })

  it('sends the same aggregator to different kitchens when the mail says so', async () => {
    // The case that makes routing-by-aggregator wrong: three YatriRestro mails,
    // three different kitchens, distinguished only by the name in the mail.
    await Listing.create({ tenantId: tenantId(),
      name: 'YATRI RESTRO', source: 'YATRIRESTRO', stationCode: 'CNB', restaurantId: cosmozin,
    })
    const a = await matchOutlet(tenantId(), 'HOTEL GANGA GALAXY', 'CNB')
    const b = await matchOutlet(tenantId(), 'THE COSMOZIN LOUNGE', 'CNB')
    const c = await matchOutlet(tenantId(), 'YATRI RESTRO', 'CNB')
    expect(a.ok && a.restaurantId).toBe(String(ganga))
    expect(b.ok && b.restaurantId).toBe(String(cosmozin))
    expect(c.ok && c.restaurantId).toBe(String(cosmozin))
  })

  it('falls back to the station default for a storefront nobody has mapped', async () => {
    const m = await matchOutlet(tenantId(), 'SOME BRAND NEW AGGREGATOR', 'CNB')
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.restaurantId).toBe(String(ganga))
    expect(m.via).toBe('station-default')
    // The name is carried through so the admin screen can offer to map it.
    expect(m.listingName).toBe('SOME BRAND NEW AGGREGATOR')
  })

  it('falls back for a listing that exists but points nowhere yet', async () => {
    await Listing.create({ tenantId: tenantId(), name: 'UNMAPPED CO', stationCode: 'CNB', restaurantId: null })
    const m = await matchOutlet(tenantId(), 'UNMAPPED CO', 'CNB')
    expect(m.ok && m.via).toBe('station-default')
    expect(m.ok && m.restaurantId).toBe(String(ganga))
  })

  it('writes down a storefront it has never seen, so it can be mapped afterwards', async () => {
    // The half of this that was missing: falling back is only forgiving if the
    // name then shows up in Setup for somebody to point at the right kitchen.
    const m = await matchOutlet(tenantId(), 'BRAND NEW CO', 'CNB', 'ZOOP')
    expect(m.ok && m.via).toBe('station-default')

    const row = await Listing.findOne({ tenantId: tenantId(), name: 'BRAND NEW CO', stationCode: 'CNB' }).lean()
    expect(row).not.toBeNull()
    expect(row?.restaurantId ?? null).toBeNull()
    expect(row?.source).toBe('ZOOP')
  })

  it('does not pile up a duplicate row when the same new name arrives twice', async () => {
    await matchOutlet(tenantId(), 'REPEATED CO', 'CNB', 'ZOOP')
    await matchOutlet(tenantId(), 'repeated co', 'CNB', 'ZOOP')
    await matchOutlet(tenantId(), 'REPEATED CO', 'CNB', 'ZOOP')
    expect(await Listing.countDocuments({ tenantId: tenantId(), stationCode: 'CNB', name: /repeated/i })).toBe(1)
  })

  it('routes the discovered storefront once an admin maps it', async () => {
    await matchOutlet(tenantId(), 'MAP ME LATER', 'CNB', 'ZOOP')
    await Listing.updateOne({ tenantId: tenantId(), name: 'MAP ME LATER' }, { $set: { restaurantId: cosmozin } })

    const m = await matchOutlet(tenantId(), 'MAP ME LATER', 'CNB', 'ZOOP')
    expect(m.ok && m.via).toBe('listing')
    expect(m.ok && m.restaurantId).toBe(String(cosmozin))
  })

  it('refuses when there is no station to fall back on', async () => {
    // RailRestro sends no station code. An unknown name then has nothing to
    // place it with, and a guess would cook food at the wrong end of India.
    const m = await matchOutlet(tenantId(), 'WHO KNOWS', null)
    expect(m.ok).toBe(false)
  })

  it('refuses when the station has no default set', async () => {
    await Station.updateOne({ tenantId: tenantId(), _id: 'CNB' }, { $set: { defaultRestaurantId: null } })
    const m = await matchOutlet(tenantId(), 'UNKNOWN BRAND', 'CNB')
    expect(m.ok).toBe(false)
    if (m.ok) return
    expect(m.detail).toContain('no default outlet')
  })

  it('refuses a known outlet whose station disagrees with the mail', async () => {
    const m = await matchOutlet(tenantId(), 'HOTEL GANGA GALAXY', 'GAYA')
    expect(m.ok).toBe(false)
  })

  it('never routes to a deactivated kitchen', async () => {
    await Restaurant.updateOne({ tenantId: tenantId(), _id: cosmozin }, { $set: { active: false } })
    await Listing.create({ tenantId: tenantId(), name: 'DEAD END', stationCode: 'CNB', restaurantId: cosmozin })
    const m = await matchOutlet(tenantId(), 'DEAD END', 'CNB')
    // Falls through to the station default rather than filing against a
    // kitchen that is closed.
    expect(m.ok && m.restaurantId).toBe(String(ganga))
  })

  it('ignores a retired storefront', async () => {
    await Listing.create({ tenantId: tenantId(),
      name: 'OLD BRAND', stationCode: 'CNB', restaurantId: cosmozin, active: false,
    })
    const m = await matchOutlet(tenantId(), 'OLD BRAND', 'CNB')
    expect(m.ok && m.via).toBe('station-default')
  })

  it('uses the station to break a tie between two storefronts sharing a name', async () => {
    const gaya = (await makeRestaurant('KHANA KHAZANA', 'GAYA'))._id
    await Listing.create({ tenantId: tenantId(), name: 'SHARED', stationCode: 'CNB', restaurantId: cosmozin })
    await Listing.create({ tenantId: tenantId(), name: 'SHARED', stationCode: 'GAYA', restaurantId: gaya })

    expect((await matchOutlet(tenantId(), 'SHARED', 'CNB')).ok).toBe(true)
    expect((await matchOutlet(tenantId(), 'SHARED', 'GAYA')).ok).toBe(true)
    // With no station there is nothing to prefer, so it refuses rather than guesses.
    expect((await matchOutlet(tenantId(), 'SHARED', null)).ok).toBe(false)
  })

  // A chain: one brand, one outlet of ours per station, all with the same
  // name (FoodOnTrains' Zaika at CNB and at GAYA). The station picks the outlet.
  it('routes a chain outlet by station when two of our outlets share its name', async () => {
    const zaikaCnb = (await makeRestaurant('ZAIKA', 'CNB'))._id
    const zaikaGaya = (await makeRestaurant('ZAIKA', 'GAYA'))._id

    const cnb = await matchOutlet(tenantId(), 'Zaika', 'CNB', 'FOODONTRAINS')
    expect(cnb.ok && cnb.restaurantId).toBe(String(zaikaCnb))
    const gaya = await matchOutlet(tenantId(), 'Zaika', 'GAYA', 'FOODONTRAINS')
    expect(gaya.ok && gaya.restaurantId).toBe(String(zaikaGaya))
    expect((await matchOutlet(tenantId(), 'Zaika', null)).ok).toBe(false)
  })

  // One fixed storefront name for every station (FoodOnTrains, HomeBytes).
  // The CNB row the first order writes down must not pull a GAYA order —
  // nor, once mapped, carry it to a CNB kitchen.
  it('never routes a mail to a storefront at another station', async () => {
    const gaya = (await makeRestaurant('KHANA KHAZANA', 'GAYA'))._id
    await Station.create({ tenantId: tenantId(), _id: 'GAYA', name: 'Gaya Junction', defaultRestaurantId: gaya })

    const cnb = await matchOutlet(tenantId(), 'FoodOnTrains', 'CNB', 'FOODONTRAINS')
    expect(cnb.ok && cnb.restaurantId).toBe(String(ganga))
    await Listing.updateOne({ tenantId: tenantId(), name: 'FoodOnTrains', stationCode: 'CNB' }, { restaurantId: cosmozin })

    const m = await matchOutlet(tenantId(), 'FoodOnTrains', 'GAYA', 'FOODONTRAINS')
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.restaurantId).toBe(String(gaya))
    expect(m.stationCode).toBe('GAYA')
    expect(await Listing.countDocuments({ tenantId: tenantId(), name: 'FoodOnTrains' })).toBe(2)

    // And the mapped CNB row still takes CNB's orders.
    const again = await matchOutlet(tenantId(), 'FoodOnTrains', 'CNB', 'FOODONTRAINS')
    expect(again.ok && again.restaurantId).toBe(String(cosmozin))
  })
})

afterAll(async () => {
  await disconnectDb()
})
