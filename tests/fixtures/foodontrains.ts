// A test order as pasted from the rendered mail: label/value gaps are runs of
// spaces, and the logo line arrived clipped ("oodontrains").
export const SAMPLE_PASTED = `oodontrains
New order FT-577998
Test · please have it ready before the train arrives

Items    2 × veg pizza 1 ₹420
1 × veg thali 1 ₹200
Station    Kanpur Central (CNB)
Train    02564 NDLS BJU SPL
Expected arrival    25 Oct, 11:50 pm
Coach and seat    VA, seat 34
Payment    Collect ₹651 in cash at the seat
Passenger    Gautam, 9821244895
Order total    ₹651 (items ₹620 + GST ₹31)
foodontrains.in · Food at your train seat`

// The same order as gmail/client.ts would flatten an HTML table of it: tabs
// after each label, and the entities htmlToText leaves undecoded. Not a real
// capture — a guard against the shape the pasted copy cannot show.
export const SAMPLE_GMAIL = `foodontrains
New order FT-577998
Test &middot; please have it ready before the train arrives

Items\t2 &times; veg pizza 1 &#8377;420
1 &times; veg thali 1 &#8377;200\t
Station\tKanpur Central (CNB)\t
Train\t02564 NDLS BJU SPL\t
Expected arrival\t25 Oct, 11:50 pm\t
Coach and seat\tVA, seat 34\t
Payment\tCollect &#8377;651 in cash at the seat\t
Passenger\tGautam, 9821244895\t
Order total\t&#8377;651 (items &#8377;620 + GST &#8377;31)\t
foodontrains.in &middot; Food at your train seat`

// The plain-text part of the mail, as FoodOnTrains documents it: "Label:
// value" lines, an "Items:" heading with rows below it, and our outlet named
// on the id line.
export const SAMPLE_PLAIN = `foodontrains · New order FT-123456 for Zaika

Items:
  2 x Aalu Paratha Combo  ₹400
  1 x Sweet Lassi  ₹60

Order ID: FT-123456
Station: Kanpur Central (CNB)
Train: 12002 Bhopal Shatabdi
Expected arrival: 26 Oct, 03:09 pm
Coach and seat: B4, seat 11
Payment: Collect ₹460 in cash at the seat
Passenger: Suman Ray, 7001573488
Order total: ₹460 (items ₹438 + GST ₹22)

foodontrains.in · Food at your train seat`
