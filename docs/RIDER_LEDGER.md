# Rider records, cash and the reporting day

How delivery and COD figures are counted, and why the rider app and the admin
dashboard now agree. Read this before changing anything under
`src/lib/repo/riderLedgerRepo.ts`, `riderCashRepo.ts` or `teamRepo.ts`.

## One ledger

Every rider figure, on every screen, comes from `riderLedgerRepo`:

| Screen | Reads |
| --- | --- |
| Rider app: History, profile "Today" | `GET /api/mobile/history` -> `riderDays` |
| Admin: Riders board, rider page | `riderBoard` -> `riderDays`, `ridersNow` |
| Store: Staff (cash to collect) | `riderCashRepo` |
| Team leader view (app) | `teamView` -> the same two |

An order is on a rider's record when they carried it (`delivery.pickedUpBy`),
or, for orders nobody has picked up yet, when it is assigned to them
(`delivery.agentIds`). It counts on the day it was **closed**
(`delivery.closedAt`), not the day it was booked for (`serviceDate`).

A **closed** order belongs to exactly one rider (`onClosedRecord`): its
carrier, else whoever the cash was charged to, else the first rider it was
given to. Closing an order always records the carrier, so the fallbacks only
matter for older orders. This is what keeps the riders' rows adding up to the
headline. Only a live order nobody has picked up is on several lists at once.

Before this, the app counted by close time on the calendar day and the admin
board counted by `serviceDate`, included orders still in hand in "total", and
summed the bill of every COD order carried rather than the cash collected. The
two could not agree except by accident.

## Two questions, two rules

Main gained its own counting rule while this was in review (see "What counts"
in `src/lib/analytics.ts`). The two are kept side by side because they answer
different questions, and each screen says which one it is answering.

| | Booked for the date | Riders' work |
| --- | --- | --- |
| Asks | what was ordered for this date | what riders finished, and the cash on it |
| Day | `serviceDate` | 3am to 3am, by close time |
| A rider's orders | every order they are on (`agentIds`), any status | orders they carried; a closed order is one rider's |
| Used by | Analytics, All orders, store history, the rider filter, the top row of the Riders board | rider app, Riders board rows and second row, rider page, team view, cash |
| Invariant | with a rider + without = the day's orders | app figures = admin rider figures |

The two rows of the Riders board will not add up to each other, and should
not: a late train booked for the 12th and delivered at 1 am is in the 12th's
bookings and in the 12th's rider work, but an order booked for the 13th and
delivered at 2 am on the 13th is in the 13th's bookings and the 12th's work.

## The reporting day: 3 am to 3 am IST

`src/lib/opsDay.ts`. A delivery at 01:30 belongs to the shift that started the
previous morning. Collections and rider figures use this day. Riders are **not**
limited to it for live work: the app lists every open order assigned to them,
whatever date it is booked for.

Not changed: the kitchen and call boards still roll over at their own hour
(`board.ts`), and Analytics still groups by `serviceDate`, because that is the
day the aggregator bills for. Analytics shows the reporting day as a column.

## Status: one stored value, three readings

`Order.status` remains the single stored status and `transitionOrder` the only
writer. `src/lib/orderViews.ts` derives what each role should see:

- **Overall** (reports): Processing, Delivered, Cancelled. Failed, missed,
  misdelivered, lost and refunded all report as Cancelled.
- **Rider**: Not ready, Ready, Picked up, Delivered, Not delivered, Return
  pending, Returned, Cancelled.
- **Kitchen**: New, Cooking, Ready, Out, Returning, Closed.

Because they are derived, they cannot contradict each other.

Rules that close the holes found:

- A rider can correct an outcome only if **they** recorded it. A failure the
  office recorded (which opens a return) cannot be flipped to Delivered from
  the app.
- An admin status override now does what the status means: closing times,
  cash, the carrier and the return are all set or cleared. Putting a closed
  order back in play clears its close time and its return, so the next close
  counts on the day it really happens. It refuses Delivered once the
  outlet has the bag back, and refuses to un-deliver an order whose cash has
  been received.
- The cash amount is fixed at the moment of delivery. Editing the bill later
  does not change what the rider owes.

## Several riders on one order

Assigning an order to several riders offers it to each. The first to **pick it
up** becomes `pickedUpBy`, and it leaves everyone else's list at that moment.
If they put it back on the counter it is offered to all of them again.

The request said "once one marks delivered". Pickup was chosen instead because
two riders cannot both be walking the same bag to a train, and a second rider
who can still see the order can still mark it. Delivery implies pickup, so the
requested behaviour holds as well.

Riders must belong to the order's outlet, for admins too. A rider from another
outlet could be assigned before, and never saw the order.

## Team leaders and receiving cash

A team leader is a rider (`role: DELIVERY_AGENT`) with `isTeamLead`. Riders
point at their leader with `teamLeadId`. It is a flag, not a new role, so a
leader keeps delivering and every existing rider rule applies to them. Admins
manage teams at Admin -> Riders -> Teams and in the staff form.

Who may mark a collection received (`src/lib/collections.ts`):

| Who | Default | Admin can change |
| --- | --- | --- |
| Admin | always | no |
| Store manager | yes | switch off per manager |
| Team leader | no | switch on per leader, own team only |
| Anyone | never their own cash | no |

Each handover is one collection (`delivery.codSettlementId`), visible to the
rider (app History), the team leader (app), the store manager (Staff) and the
admin (rider page, Collections tab).

## Open questions

1. Cash a team leader receives is treated as received by the business. There
   is no second step where the leader hands it to the store. If that is
   needed, it is a second ledger stage on top of `codSettlementId`.
2. Pickup, not delivery, removes an order from the other riders (above).
3. The kitchen and telecaller status labels exist in `orderViews.ts` but the
   store and call boards still show their own existing wording.
4. `npm run audit:riders` lists existing records that break these rules. It
   has not been run against production data.

## After deploying

```bash
npm run indexes                    # adds rider_record
npm run audit:riders               # read-only report
npm run audit:riders -- --apply    # fills in close time and carrier on older orders
```

The rider app needs a new build for the keyboard fix and the team view. Older
builds keep working against the new server.
