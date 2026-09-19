import { beforeEach, describe, expect, it } from 'vitest'
import { Restaurant, PrintJob, Station } from '../src/lib/models'
import { migrateStationPrinting } from '../scripts/migrate-station-printing'
import { resetDb, makeRestaurant } from './fixtures'

/**
 * The migration's one job that really matters: the token a live kitchen agent
 * is already polling with must survive, byte for byte, so nobody has to visit
 * the outlet and edit a .env file.
 */

beforeEach(resetDb)

describe('migrateStationPrinting', () => {
  it('adopts the live outlet token onto its station, unchanged', async () => {
    const token = 'e4gzvMsO3l0pl_UaSo-iQ5SXnB6k77jd'
    await makeRestaurant('YATRI BHOJAN', 'CNB')
    await Restaurant.updateOne({ name: 'YATRI BHOJAN' }, { $set: { printAgentToken: token } })
    await makeRestaurant('YATRI RESTRO', 'CNB')

    const report = await migrateStationPrinting()

    expect(report.stationsCreated).toEqual(['CNB'])
    expect(report.tokensAdopted).toEqual(['CNB'])
    expect((await Station.findById('CNB'))!.printAgentToken).toBe(token)
  })

  it('creates one station for many brands trading there', async () => {
    await makeRestaurant('YATRI BHOJAN', 'CNB')
    await makeRestaurant('YATRI RESTRO', 'CNB')
    await makeRestaurant('ZOOP', 'CNB')

    await migrateStationPrinting()

    expect(await Station.countDocuments({})).toBe(1)
  })

  it('is idempotent and never rotates a token out from under a live agent', async () => {
    await makeRestaurant('YATRI BHOJAN', 'CNB')
    await Restaurant.updateOne({}, { $set: { printAgentToken: 'original' } })

    await migrateStationPrinting()
    const second = await migrateStationPrinting()

    expect(second.stationsCreated).toEqual([])
    expect(second.tokensAdopted).toEqual([])
    expect((await Station.findById('CNB'))!.printAgentToken).toBe('original')
  })

  it('refuses to guess when two outlets at one station hold tokens', async () => {
    await makeRestaurant('YATRI BHOJAN', 'CNB')
    await makeRestaurant('YATRI RESTRO', 'CNB')
    await Restaurant.updateOne({ name: 'YATRI BHOJAN' }, { $set: { printAgentToken: 'tok-a' } })
    await Restaurant.updateOne({ name: 'YATRI RESTRO' }, { $set: { printAgentToken: 'tok-b' } })

    const report = await migrateStationPrinting()

    // Picking one would 401 the other agent with no explanation.
    expect((await Station.findById('CNB'))!.printAgentToken).toBeNull()
    expect(report.warnings.join(' ')).toMatch(/refusing to guess/)
  })

  it('settles one authoritative station name and reports the disagreement', async () => {
    await Restaurant.create({ name: 'A', stationCode: 'CNB', stationName: 'Kanpur Central' })
    await Restaurant.create({ name: 'B', stationCode: 'CNB', stationName: 'Kanpur Central' })
    await Restaurant.create({ name: 'C', stationCode: 'CNB', stationName: 'KANPUR CNTRL' })

    const report = await migrateStationPrinting()

    expect((await Station.findById('CNB'))!.name).toBe('Kanpur Central')
    expect(report.warnings.join(' ')).toMatch(/disagree on the station name/)
  })

  it('backfills in-flight jobs queued under the old per-outlet shape', async () => {
    const outlet = await makeRestaurant('YATRI BHOJAN', 'CNB')
    await PrintJob.collection.insertOne({
      restaurantId: outlet._id,
      refType: 'order',
      refId: 'order-1',
      images: [],
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const report = await migrateStationPrinting()

    expect(report.jobsBackfilled).toBe(1)
    expect((await PrintJob.collection.findOne({ refId: 'order-1' }))!.stationCode).toBe('CNB')
  })

  it('reports a job pointing at a deleted outlet rather than guessing its station', async () => {
    await makeRestaurant('YATRI BHOJAN', 'CNB')
    await PrintJob.collection.insertOne({
      restaurantId: new (await import('mongoose')).default.Types.ObjectId(),
      refType: 'order',
      refId: 'orphan',
      images: [],
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const report = await migrateStationPrinting()

    expect(report.orphanJobs).toBe(1)
    expect(report.jobsBackfilled).toBe(0)
  })

  it('resolves a lowercase outlet station code to the uppercase station', async () => {
    await Restaurant.collection.insertOne({
      name: 'sloppy', stationCode: 'cnb', active: true, aliases: [],
      createdAt: new Date(), updatedAt: new Date(),
    })

    await migrateStationPrinting()

    expect(await Station.findById('CNB')).not.toBeNull()
    expect(await Station.countDocuments({})).toBe(1)
  })
})
