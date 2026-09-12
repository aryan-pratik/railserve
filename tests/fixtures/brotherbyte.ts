// The real order-confirmation mail: an HTML table converted to tab-separated
// label/value lines, no colons, no bold markers.
export const SAMPLE_1 = `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101304/2485260978
Train\t12323/HWH BME EXP
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t09-12-2026 09:10 IST
Coach & Berth\tB5/66
Customer\tABHISHEK VAISNAV (7984434724)
Items\t1-Amritsari Thali (veg) - Matar Paneer, Chole, Dal Tadka, Jeera Rice, Butter Tawa Roti 3pcs, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper
Payment Method\tCash On Delivery
Order Total\t₹213.15
GST/Tax\t₹10.15
Discount\t₹0
Outlet Discount\t₹0
Amount to Collect\t₹213
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`

// An earlier hand-typed sample of the same vendor's mail, in a WhatsApp-style
// "Label: *value*" layout with separate Customer/Phone fields. Not what the
// real mail looks like, but the parser stays tolerant of it too.
export const SAMPLE_LEGACY_COLON_FORMAT = `Dear *The Cosmozin Lounge*,
New Order No: *1*

Order ID: *BB00101303/2485257102*
Train: *12323/HWH BME EXP*
Delivery Station: *KANPUR CENTRAL (CNB)*
Delivery Date & Time: *09-12-2026 09:10 IST*
Coach & Berth: *B5/66*
Customer: *ABHISHEK VAISNAV*
Phone: *7984434724*

*Order Items:*
*1-Chicken Biryani With Raita Combo (non-veg) - Chicken Biryani 2pcs, Raita, Chilli Sauce, Tomato Sauce, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper*

Payment Method: *Cash On Delivery*
Order Total: *243.60*
Amount to Collect: *244*

Customer Notes:
*Provide Good food*

Restaurant Partner App:
*https://play.google.com/console*

Thank you for partnering with BrotherByte. Happy Serving!`
