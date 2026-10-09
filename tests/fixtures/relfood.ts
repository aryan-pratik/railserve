// A real order-summary mail as copied out of a mail client and pasted: the
// HTML table's label/value gaps arrive as runs of four spaces, and the item
// cell holds the dish on one line with what it comes with on the next.
export const MAIL_SAMPLE = `
Have it your way!
Need Help? Call us at +91 8885532544

Samim Abedin
IRCTC Order No. 2493864512
Booking Date : 09-10-2026
Confirm Order
ORDER SUMMERY
Customer Name    Samim Abedin
Contact Number    9563871687
PNR    XXXXXXXXXX
Train No./Name    15483 / SIKKIMMAHANANDA
Coach/Seat    A1/26
Payment Mode    PAID
Payment to collect    0
BILL DETAILS
REL FOOD Ref.No : 1192186
OUTLET NAME : THE COSMOZIN LOUNGE
Station Name & Code : KANPUR CENTRAL (CNB)
Delivery Date & Time : 10/9/2026 & 12:50
Item    Price    Quantity    Total
Special Egg Thali
Egg Curry (2pcs), Daal Fry, Jeera Rice, Tava Roti (3pcs), Salad, Pickle, Gulab Jamun, Spoon, Paper Napkin    239    1    239
Sub Total    239
Delivery Fee    0.00
GST    12
Total    251
RELFOOD - A Unit of Durga Enterprises
GST Number : 37AANFS2856B1Z2`

// A real mail as the Gmail sync sees it: HTML only, no text/plain part, so
// this is gmail/client.ts's flattening of the markup. Table gaps are tabs, the
// "ORDER SUMMERY" heading shares a line with the first row beneath it, and the
// summary rows open with the tab of an empty first cell. A different order
// from MAIL_SAMPLE, and cash on delivery where that one is prepaid.
export const MAIL_SAMPLE_GMAIL = `Untitled Document             Have it your way!
    Need Help? Call us at +91 8885532544
  \t   \t     Sunil Sharma
  IRCTC Order No. 2493531802
   Booking Date : 08-10-2026
 Confirm Order

   ORDER SUMMERY    Customer Name \t  Sunil Sharma
   Contact Number \t  6393369360
   PNR \t  XXXXXXXXXX
   Train No./Name \t  12512 / RAPTISAGAR SF EX
   Coach/Seat \t  B7/65
  Payment Mode\t  COD
  Payment to collect\t  158

      BILL DETAILS

      REL FOOD Ref.No : 1190676
   OUTLET NAME : THE COSMOZIN LOUNGE
   Station Name & Code : KANPUR CENTRAL (CNB)
   Delivery Date & Time : 10/8/2026 & 07:55

   Item\tPrice\tQuantity\tTotal
Veg Mini Thali
Seasonal Veg, Daal Fry, Jeera Rice, Tava Roti (2pcs), Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper\t150\t1\t150
\tSub Total\t150
\tDelivery Fee\t0.00
\tGST\t8
\tTotal\t158

       RELFOOD - A Unit of Durga Enterprises  \t  GST Number : 37AANFS2856B1Z2`

// The real WhatsApp message for the same order as MAIL_SAMPLE. It carries
// RelFood's reference as "Order ID" and no IRCTC order number at all.
export const WHATSAPP_SAMPLE = `Your order has been confirmed. Please find the details below:

Order Information:
Order ID: 1192186
Station: KANPUR CENTRAL (CNB)
Outlet: THE COSMOZIN LOUNGE
Train: 15483 (SIKKIMMAHANANDA)
Compartment: A1/26

Customer Details:
Name: Samim Abedin
Phone: 9563871687

Order Summary:
Items Ordered: 1 x Special Egg Thali..
Delivery Date Time: 09-10-2026 12:50

Payment Information:
Amount: ₹ 251
Order Type: PRE_PAID

Additional Remarks: NA

If you have any questions regarding your order, please contact our support team.`
