// A real "New Order Notification", exactly as it arrived.
export const SAMPLE = `New Order Notification

Order Details:
- IRCTC Order ID: *2504099482*
- Name: *Jitu Singh *
- Phone: 9718847329
- Payment Type: *PRE_PAID*
- Train: *05094/HDP GKP SPECIAL*
- Station: *KANPUR CENTRAL*
- Arrival Time: *15:21*
- Arrival Date: *13-11-2026*
- Coach & Seat: *A2*/*39*

Menu Items:
*1 x PANEER CURRY WITH ROTI COMBO (Veg),*

Order Total: ₹*197*
Amount to Collect: ₹*0*

Customer Note: *Provide Good Food*

This is an automated notification.`

// The same message with its ampersand still HTML-escaped, as it shows up when
// copied out of a rendered view or a mail part nothing has decoded.
export const SAMPLE_ESCAPED = SAMPLE.replace('Coach & Seat', 'Coach &amp; Seat')

// What gmail/client.ts makes of an HTML version: CRLF line ends, the list's
// bullets gone, a tab trailing each cell, and the rupee sign as an entity.
export const SAMPLE_GMAIL = SAMPLE.replace(/^- /gm, '')
  .replace(/₹/g, '&#8377;')
  .replace(/\n/g, '\t\r\n')

// Cash on delivery, two items on lines of their own and one sharing a line.
export const SAMPLE_COD = `New Order Notification

Order Details:
- IRCTC Order ID: *2504100001*
- Name: *Asha Verma*
- Phone: +91 98765 43210
- Payment Type: *CASH_ON_DELIVERY*
- Train: *12560/SHIV GANGA EXP*
- Station: *PRAYAGRAJ JN*
- Arrival Time: *06:05*
- Arrival Date: *01-12-2026*
- Coach & Seat: *B3*/*12*

Menu Items:
*2 x VEG THALI (Veg),*
*1 x EGG BIRYANI (Non-Veg), 3 x WATER BOTTLE,*

Order Total: ₹*540*
Amount to Collect: ₹*540*

Customer Note: *NA*

This is an automated notification.`
