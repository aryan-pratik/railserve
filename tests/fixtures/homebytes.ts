// The real order-confirmation mail: same AdminLTE-templated shape as
// RajBhog's, but the item table's label/value gaps are real tabs (an HTML
// table flattened to text), and the Description cell itself carries
// irregular double-space runs around each "+" join — column-splitting on
// whitespace runs (RajBhog's approach) would misread that as extra columns.
export const SAMPLE_1 = `Booking Date: 14 Sep 2026, 08:53
Delivery Date: 14 Sep 2026, 13:30
FSSAI NO.: 22725315001462\tAdminLTE Logo

To
Customer Name : Satvir
Customer Contact : 9718488269
Customer Email :

Invoice HB001273086 / 2486073972
Payment: CASH_ON_DELIVERY
Coach / Berth: H1/G / 19
Train: 13051 / NETAJI EXPRESS
Delivery Station: CNB / KANPUR CENTRAL

SL#\tItem\tDescription\tQty\tPrice\tGST\tAmount
1\tNon Veg Mini Thali\tChicken curry  2pcs  +  Daal fry +  Jeera rice +  Tava roti  2pcs  +  Salad +  Pickle +  Gulab jamun +  Spoon +  Tissue paper\t1\t240.00\t12.00\t240.00
Subtotal:\t240.00
GST (5%)\t12.00
Discount\t0.00
Delivery:\t0
Total:\t252.00
1. Please take the OTP from customer on delivery and update the delivery status on HomeBytes Vendor Dashboard/App.
2. Please Note if PAYMENT MODE is COD (Cash On Delivery). It is vendors responsibility to collect cash at the time of delivery.

This is Computer generated mail. Please do no reply.

Warm Regards
HomeBytes
Phone Np. 91 9234282644`
