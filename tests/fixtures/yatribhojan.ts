// The real order-confirmation mail: colon-delimited fields between `-----`
// dividers, items between `****` dividers. Simple coach, no booking status.
export const SAMPLE_1 = `TEAM YATRIBHOJAN

ORDER NO: 57606971
PAYMODE: COD
-----
DELIVERY: 31-08-2026, ETA: 14:10
STATION: KANPUR CENTRAL (CNB)
TRAIN: 12488, SEEMANCHAL EXP
COACH: B2, SEAT: 59
NAME: Sonu Mehra
MOB: 9871234560
-----
ITEM DETAILS
****
Veg Biryani With Raita Combo X 1
****
NET TOTAL: Rs. 150.00

TEAM YATRIBHOJAN`

// A real order with a RAC-status coach prefix — the status isn't a coach
// code, so it's kept separate from the coach and stitched back into rawSeat.
export const SAMPLE_RAC_COACH = `TEAM YATRIBHOJAN

ORDER NO: 57610000
PAYMODE: PREPAID
-----
DELIVERY: 01-09-2026, ETA: 23:05
STATION: KANPUR CENTRAL (CNB)
TRAIN: 12394, SEEMANCHAL EXP
COACH: RAC/B2, SEAT: 39
NAME: Test Customer
MOB: 9871234561
-----
ITEM DETAILS
****
Aloo Paratha With Chole Combo X 1
****
NET TOTAL: Rs. 175.00

TEAM YATRIBHOJAN`

// A real order whose coach itself is alphanumeric with a "/<sub-code>"
// suffix — "H1/D, SEAT: 11" (First AC coach H1, cabin D). This isn't a
// RAC/WL booking-status prefix, so it must not be split off as one; it's
// part of the coach.
export const SAMPLE_ALPHANUMERIC_COACH = `TEAM YATRIBHOJAN

ORDER NO: 57614593
PAYMODE: PREPAID
-----
DELIVERY: 11-09-2026, ETA: 21:50
STATION: KANPUR CENTRAL (CNB)
TRAIN: 12310, RJPB TEJAS RAJ
COACH: H1/C, SEAT: 9
NAME: Rupesh
MOB: 7858095122
-----
ITEM DETAILS
****
Chicken Biryani With Raita Combo X 1
****
NET TOTAL: Rs. 230.00

TEAM YATRIBHOJAN`

// Same alphanumeric-coach shape as above, sub-code "D" instead of "C" — a
// second real order confirming it's not a one-off.
export const SAMPLE_ALPHANUMERIC_COACH_2 = `TEAM YATRIBHOJAN

ORDER NO: 57615301
PAYMODE: COD
-----
DELIVERY: 13-09-2026, ETA: 08:00
STATION: KANPUR CENTRAL (CNB)
TRAIN: 12522, RAPTISAGAR EXP
COACH: H1/D, SEAT: 11
NAME: Vivek
MOB: 8075771877
-----
ITEM DETAILS
****
Aloo Paratha With Chole Combo X 1
****
NET TOTAL: Rs. 175.00

TEAM YATRIBHOJAN`
