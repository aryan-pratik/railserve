/** The exact sample from plan §6, including its emoji delivery line. */
export const SAMPLE_WITH_EMOJI = `*Order From YatriRestro*
*Order Id : #1000584805*
-----------------------------
Outlet Name- HOTEL GANGA GALAXY
Station Code/Name - KANPUR CENTRAL-CNB
-----------------------------
*Delivery Details*
👤 Neelesh Soni |  📞 9752446747 |  🚆 12506-NORTH EAST EXP |  💺 B5-37 | 🕐 27-Aug 13:25
-----------------------------
*Order Items*
Paneer Paratha With Curd Combo - 1 |
-----------------------------
*Amount-236 - CASH_ON_DELIVERY*
-----------------------------
Note-
1000584805.
Thank You.`

/** Same order with emoji stripped — the positional fallback path. */
export const SAMPLE_NO_EMOJI = `*Order From YatriRestro*
*Order Id : #1000584805*
-----------------------------
Outlet Name- HOTEL GANGA GALAXY
Station Code/Name - KANPUR CENTRAL-CNB
-----------------------------
*Delivery Details*
Neelesh Soni |  9752446747 |  12506-NORTH EAST EXP |  B5-37 | 27-Aug 13:25
-----------------------------
*Order Items*
Paneer Paratha With Curd Combo - 1 |
-----------------------------
*Amount-236 - CASH_ON_DELIVERY*
-----------------------------
Note-
1000584805.
Thank You.`

export const MULTI_ITEM = `*Order From YatriRestro*
*Order Id : #1000584999*
-----------------------------
Outlet Name- HOTEL GANGA GALAXY
Station Code/Name - KANPUR CENTRAL-CNB
-----------------------------
*Delivery Details*
👤 Anita Verma |  📞 9839044444 |  🚆 12312-KALKA MAIL |  💺 S3-45 | 🕐 27-Aug 09:40
-----------------------------
*Order Items*
Veg Thali - 2 |
Masala Chai - 3 | extra sugar
Mineral Water 1L - 1 |
-----------------------------
*Amount-1,250.50 - PREPAID*
-----------------------------
Thank You.`

/** Coach with no berth, and a hyphenated station name. */
export const ODD_SEAT_AND_STATION = `*Order From YatriRestro*
*Order Id : #1000585111*
-----------------------------
Outlet Name- SHREE ANNAPURNA BHOJNALAYA
Station Code/Name - PRAYAGRAJ-JN-PRYJ
-----------------------------
*Delivery Details*
👤 Rakesh Tiwari |  📞 9839055555 |  🚆 12554-VAISHALI EXP |  💺 GEN | 🕐 31-Dec 23:50
-----------------------------
*Order Items*
Chicken Biryani - 1 |
-----------------------------
*Amount-310 - CASH_ON_DELIVERY*
-----------------------------`

/** No items section at all — must land in the unparsed inbox, not be inserted. */
export const MALFORMED_NO_ITEMS = `*Order From YatriRestro*
*Order Id : #1000585222*
-----------------------------
Outlet Name- HOTEL GANGA GALAXY
Station Code/Name - KANPUR CENTRAL-CNB
-----------------------------
*Delivery Details*
👤 Someone |  📞 9000000000 |  🚆 12506-NORTH EAST EXP |  💺 B1-1 | 🕐 27-Aug 13:25
-----------------------------
*Amount-100 - CASH_ON_DELIVERY*`

/** Outlet we have never heard of — must NOT be fuzzy-matched into a kitchen. */
export const UNKNOWN_OUTLET = `*Order From YatriRestro*
*Order Id : #1000585333*
-----------------------------
Outlet Name- SOME RANDOM DHABA
Station Code/Name - KANPUR CENTRAL-CNB
-----------------------------
*Delivery Details*
👤 Someone |  📞 9000000000 |  🚆 12506-NORTH EAST EXP |  💺 B1-1 | 🕐 27-Aug 13:25
-----------------------------
*Order Items*
Veg Thali - 1 |
-----------------------------
*Amount-150 - CASH_ON_DELIVERY*`

export const GARBAGE = `Hello, this is a newsletter about trains.
Nothing structured here at all.`

/** Ordered on 31 Dec for a train arriving after midnight — the plan's own rollover case. */
export const NEW_YEAR_CROSSING = `*Order From YatriRestro*
*Order Id : #1000585444*
-----------------------------
Outlet Name- HOTEL GANGA GALAXY
Station Code/Name - KANPUR CENTRAL-CNB
-----------------------------
*Delivery Details*
👤 Priya Nair |  📞 9839077777 |  🚆 12506-NORTH EAST EXP |  💺 B2-14 | 🕐 01-Jan 06:30
-----------------------------
*Order Items*
Poha - 2 |
-----------------------------
*Amount-120 - CASH_ON_DELIVERY*`
