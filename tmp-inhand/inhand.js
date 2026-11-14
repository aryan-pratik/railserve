// READ-ONLY. Only find / aggregate / countDocuments. Writes nothing.
const { MongoClient } = require('mongodb')
const TZ = 'Asia/Kolkata'
;(async () => {
  const c = new MongoClient(process.env.MONGODB_URI)
  await c.connect()
  const db = c.db()
  const O = db.collection('orders'), U = db.collection('users')
  const now = new Date()
  const riders = await U.find({ role: 'DELIVERY_AGENT' }).project({ name: 1, phone: 1, active: 1 }).toArray()
  const nameOf = new Map(riders.map((r) => [String(r._id), r.name]))
  const out = { now: now.toISOString(), riders: {} }

  const bucket = (field, edges, labels, nullLabel) => ({
    $switch: {
      branches: [
        ...(nullLabel ? [{ case: { $eq: [field, null] }, then: nullLabel }] : []),
        ...edges.map((e, i) => ({ case: { $lt: [field, e] }, then: labels[i] })),
      ],
      default: labels[labels.length - 1],
    },
  })
  const count = (id) => [{ $group: { _id: id, n: { $sum: 1 } } }, { $sort: { n: -1 } }]

  for (const r of riders) {
    const match = {
      status: 'DISPATCHED',
      $or: [{ 'delivery.pickedUpBy': r._id }, { 'delivery.pickedUpBy': null, 'delivery.agentIds': r._id }],
    }
    const total = await O.countDocuments(match)
    if (!total) continue
    const [res] = await O.aggregate([
      { $match: match },
      {
        $addFields: {
          _ageDays: {
            $dateDiff: { startDate: { $dateFromString: { dateString: '$serviceDate', timezone: TZ } }, endDate: now, unit: 'day', timezone: TZ },
          },
          _dispH: {
            $cond: [{ $ne: [{ $ifNull: ['$delivery.dispatchedAt', null] }, null] }, { $dateDiff: { startDate: '$delivery.dispatchedAt', endDate: now, unit: 'hour' } }, null],
          },
          _arrH: {
            $cond: [{ $ne: [{ $ifNull: ['$scheduledArrival', null] }, null] }, { $dateDiff: { startDate: '$scheduledArrival', endDate: now, unit: 'hour' } }, null],
          },
          _dispEvent: { $last: { $filter: { input: '$events', cond: { $eq: ['$$this.toStatus', 'DISPATCHED'] } } } },
        },
      },
      { $addFields: { _by: '$_dispEvent.userId' } },
      { $lookup: { from: 'users', localField: '_by', foreignField: '_id', as: '_actor' } },
      {
        $addFields: {
          _role: { $ifNull: [{ $arrayElemAt: ['$_actor.role', 0] }, 'no event / unknown'] },
          _byRider: { $eq: ['$_by', r._id] },
        },
      },
      {
        $facet: {
          byServiceDateAge: [
            { $group: { _id: bucket('$_ageDays', [1, 2, 4, 8, 15, 31], ['0 today', '1 day', '2-3 days', '4-7 days', '8-14 days', '15-30 days', '31+ days']), n: { $sum: 1 }, cod: { $sum: { $cond: [{ $eq: ['$paymentMode', 'COD'] }, 1, 0] } }, codPaise: { $sum: { $cond: [{ $eq: ['$paymentMode', 'COD'] }, { $ifNull: ['$amountPaise', 0] }, 0] } } } },
            { $sort: { n: -1 } },
          ],
          byHoursSinceMarkedDispatched: [
            ...count(bucket('$_dispH', [3, 24, 72, 168], ['<3h', '3-24h', '1-3d', '3-7d', '7d+'], 'no dispatchedAt')),
          ],
          byHoursSinceTrainDue: [
            ...count(bucket('$_arrH', [0, 24, 72, 168], ['train not due yet', 'due 0-24h ago', '1-3d ago', '3-7d ago', '7d+ ago'], 'no arrival time')),
          ],
          pickupRecord: count({ pickedUpBySet: { $ne: [{ $ifNull: ['$delivery.pickedUpBy', null] }, null] }, dispatchedAtSet: { $ne: [{ $ifNull: ['$delivery.dispatchedAt', null] }, null] }, assignedAtSet: { $ne: [{ $ifNull: ['$delivery.assignedAt', null] }, null] }, ridersOnOrder: { $size: { $ifNull: ['$delivery.agentIds', []] } } }),
          whoMarkedDispatched: count({ role: '$_role', wasTheCarrierThemselves: '$_byRider' }),
          dispatchEventMeta: [{ $group: { _id: { $objectToArray: { $ifNull: ['$_dispEvent.meta', {}] } } , n: { $sum: 1 } } }, { $project: { keys: { $map: { input: '$_id', as: 'kv', in: '$$kv.k' } }, n: 1 } }, { $sort: { n: -1 } }, { $limit: 5 }],
          assignedInOneMinute: [
            { $group: { _id: { $dateTrunc: { date: '$delivery.assignedAt', unit: 'minute', timezone: TZ } }, n: { $sum: 1 } } },
            { $sort: { n: -1 } }, { $limit: 8 },
          ],
          assignedByDay: [
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$delivery.assignedAt', timezone: TZ, onNull: 'no assignedAt' } }, n: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          markedDispatchedByDay: [
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$delivery.dispatchedAt', timezone: TZ, onNull: 'no dispatchedAt' } }, n: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          dispatchedWithinMinutesOfAssign: [
            { $group: { _id: { $cond: [{ $or: [{ $eq: [{ $ifNull: ['$delivery.assignedAt', null] }, null] }, { $eq: [{ $ifNull: ['$delivery.dispatchedAt', null] }, null] }] }, 'unknown', { $cond: [{ $lt: [{ $abs: { $subtract: ['$delivery.dispatchedAt', '$delivery.assignedAt'] } }, 120000] }, 'dispatched within 2 min of assigning', 'dispatched later'] }] }, n: { $sum: 1 } } },
          ],
          sourceAndPayment: count({ source: '$source', pay: '$paymentMode' }),
          returnsAndCancels: count({ rto: { $ifNull: ['$rto.status', 'none'] }, cancelRequest: { $ifNull: ['$cancelRequest.status', 'none'] }, hasClosedAt: { $ne: [{ $ifNull: ['$delivery.closedAt', null] }, null] }, hasDeliveredAt: { $ne: [{ $ifNull: ['$delivery.deliveredAt', null] }, null] } }),
          dates: [{ $group: { _id: null, oldestServiceDate: { $min: '$serviceDate' }, newestServiceDate: { $max: '$serviceDate' }, firstDispatched: { $min: '$delivery.dispatchedAt' }, lastDispatched: { $max: '$delivery.dispatchedAt' } } }],
          oldestFive: [
            { $sort: { serviceDate: 1 } }, { $limit: 5 },
            { $project: { _id: 0, id: '$externalOrderId', serviceDate: 1, trainNo: 1, source: 1, amountPaise: 1, dispatchedAt: '$delivery.dispatchedAt', assignedAt: '$delivery.assignedAt', markedBy: '$_role', events: { $size: '$events' } } },
          ],
        },
      },
    ]).toArray()
    out.riders[r.name + ' (' + (r.active ? 'active' : 'inactive') + ')'] = { dispatchedAndOnTheirRecord: total, ...res }
  }

  // What those same riders did with orders in the last 30 days: who closed them.
  const since = new Date(now.getTime() - 30 * 86400000)
  out.closedLast30Days = await O.aggregate([
    { $match: { status: { $in: ['DELIVERED', 'FAILED', 'CANCELLED', 'MISSED_DELIVERY', 'MISDELIVERY', 'REFUNDED'] }, createdAt: { $gte: since }, 'delivery.agentIds.0': { $exists: true } } },
    { $addFields: { _last: { $last: '$events' } } },
    { $lookup: { from: 'users', localField: '_last.userId', foreignField: '_id', as: '_a' } },
    { $group: { _id: { status: '$status', closedByRole: { $ifNull: [{ $arrayElemAt: ['$_a.role', 0] }, 'none'] } }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray()

  // Every DISPATCHED order in the system, with or without a rider on it.
  out.allDispatchedOrders = await O.aggregate([
    { $match: { status: 'DISPATCHED' } },
    { $group: { _id: { hasRider: { $gt: [{ $size: { $ifNull: ['$delivery.agentIds', []] } }, 0] } }, n: { $sum: 1 }, oldest: { $min: '$serviceDate' }, newest: { $max: '$serviceDate' } } },
  ]).toArray()
  out.riderNames = Object.fromEntries(nameOf)
  console.log(JSON.stringify(out, null, 1))
  await c.close()
})().catch((e) => { console.error(e); process.exit(1) })
