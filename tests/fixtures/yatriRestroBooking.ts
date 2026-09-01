/** The exact sample forwarded from the vendor's "Order Booking Confirmation" template. */
export const SAMPLE = `Order Booking Confirmation
Dear aman,
Your order has been booked now. Be relaxed and enjoy your journey. We will deliver your order at your seat. Please find the order details below:

Order details:
ORDER No\t1000085034\tMOBILE NO\t8789151114
CUSTOMER NAME\taman\tTRAIN No /NAME\t22465 / BABA B DHAM EXP
DELIVERY DATE\t\tCOACH/BERTH\tA1 / 21
PAYMENT STATUS\tCASH_ON_DELIVERY\tStation Code/Name\tDDU / PT.DEEN DAYAL UPADHYAYA JN.
Outlet Name\tTHE CHINESE HUB\tOutlet Contact\t9264296066
Order Item Details:
Item\tDescription\tPrice\tQuantity\tAmount
Chicken lollipop Fry 4pc\t4pc\t₹ 216\t1\t₹ 216
Sub Total\t₹ 216
GST\t₹ 10.8
Discount\t₹ 0
Grand Total (Inclusive of all taxes)\t₹ 227
Warm Regards,
YATRI RESTRO`

/** Same content as copy-pasted from a rendered table — multiple spaces instead of tabs. */
export const SAMPLE_SPACE_DELIMITED = `Order Booking Confirmation
Dear aman,
Your order has been booked now. Be relaxed and enjoy your journey. We will deliver your order at your seat. Please find the order details below:

Order details:
ORDER No    1000085034    MOBILE NO    8789151114
CUSTOMER NAME    aman    TRAIN No /NAME    22465 / BABA B DHAM EXP
DELIVERY DATE        COACH/BERTH    A1 / 21
PAYMENT STATUS    CASH_ON_DELIVERY    Station Code/Name    DDU / PT.DEEN DAYAL UPADHYAYA JN.
Outlet Name    THE CHINESE HUB    Outlet Contact    9264296066
Order Item Details:
Item    Description    Price    Quantity    Amount
Chicken lollipop Fry 4pc    4pc    ₹ 216    1    ₹ 216
Sub Total    ₹ 216
GST    ₹ 10.8
Discount    ₹ 0
Grand Total (Inclusive of all taxes)    ₹ 227
Warm Regards,
YATRI RESTRO`

/** Two dishes — the loop-over-items path must not stop at the first row. */
export const MULTI_ITEM = `Order Booking Confirmation
Dear Priya,
Your order has been booked now.

Order details:
ORDER No\t1000085111\tMOBILE NO\t9839044444
CUSTOMER NAME\tPriya\tTRAIN No /NAME\t12312 / KALKA MAIL
DELIVERY DATE\t\tCOACH/BERTH\tS3 / 45
PAYMENT STATUS\tPREPAID\tStation Code/Name\tCNB / KANPUR CENTRAL
Outlet Name\tHOTEL GANGA GALAXY\tOutlet Contact\t9264296066
Order Item Details:
Item\tDescription\tPrice\tQuantity\tAmount
Veg Thali\t\t₹ 400\t2\t₹ 800
Masala Chai\textra sugar\t₹ 15\t3\t₹ 45
Sub Total\t₹ 845
GST\t₹ 42.25
Discount\t₹ 0
Grand Total (Inclusive of all taxes)\t₹ 887.25
Warm Regards,
YATRI RESTRO`

/** No item rows at all — must land in the unparsed inbox, not be inserted. */
export const MALFORMED_NO_ITEMS = `Order Booking Confirmation
Dear aman,

Order details:
ORDER No\t1000085222\tMOBILE NO\t8789151114
CUSTOMER NAME\taman\tTRAIN No /NAME\t22465 / BABA B DHAM EXP
DELIVERY DATE\t\tCOACH/BERTH\tA1 / 21
PAYMENT STATUS\tCASH_ON_DELIVERY\tStation Code/Name\tDDU / PT.DEEN DAYAL UPADHYAYA JN.
Outlet Name\tTHE CHINESE HUB\tOutlet Contact\t9264296066
Order Item Details:
Grand Total (Inclusive of all taxes)\t₹ 227
Warm Regards,
YATRI RESTRO`

export const GARBAGE = `Hello, this is a newsletter about trains.
Nothing structured here at all.`

/**
 * The vendor's real HTML, verbatim from /admin/inbox's raw-email view. Not a
 * real <table> at all — one <div> per label/value with no delimiter between
 * them, so each ends up alone on its own line rather than sharing a
 * tab/space-delimited row. Also spreads a single item's five columns (and the
 * item-table header itself) one per line, and puts the Grand Total amount on
 * the line AFTER its label rather than beside it.
 */
export const SAMPLE_ONE_TOKEN_PER_LINE = `My Web Page




        Order Confirmation

        Dear Partner,

        Please prepare order and deliver order on time.


        Order details:




        ORDER No
        1000591416
        MOBILE NO
        9939978198



        CUSTOMER NAME
        Akash
        TRAIN No /NAME
        12488 / SEEMANCHAL EXP



        DELIVERY DATE
        01-09-2026, 14:10
        COACH/BERTH
        A2 / 19



        PAYMENT STATUS
        CASH_ON_DELIVERY
        Station Code/Name
        CNB / KANPUR CENTRAL




        Order Item Details:




        Item
        Description
        Price
        Quantity
        Amount




                Veg Maharaja Thali
                Paneer veg dish Seasonal veg dal tadka Jeera rice Butter tava roti 3pcs Salad Pickle Gulab jamun Spoon Paper napkin

                ₹ 225
                 3
                ₹ 675






        Sub Total
        ₹ 675



        GST
        ₹ 33.75



        DISCOUNT
        ₹ 0



        Grand Total (Inclusive of all taxes)
        ₹ 709






        Warm Regards,

YATRI RESTRO


        This is a system generated email. Please do not reply to this email ID. If you have a query or need any clarification you
        may contact us using any of the communication medium described below:

        Please confirm train time. Delivery Time may be vary.

        Call our 24-hour Customer Care at 9264296066

        Email Us support@yatrirestrocom`

/**
 * Real "Dear Partner" order pulled from /admin/inbox — same missing-outlet-name
 * gap as SAMPLE_PARTNER_NO_OUTLET, plus a coach/berth shape not seen before:
 * "RAC/A2 / 17", a waitlist-status prefix ahead of the usual coach/berth pair.
 * Two items on separate rows, and PAYMENT STATUS is "ONLINE" rather than
 * "CASH_ON_DELIVERY".
 */
export const SAMPLE_RAC_SEAT = `Order Confirmation
Dear Partner,
Please prepare order and deliver order on time.

Order details:
ORDER No\t1000591314\tMOBILE NO\t9818071386
CUSTOMER NAME\tNilamber paswan\tTRAIN No /NAME\t12561 / SWATANTRA S EXP
DELIVERY DATE\t01-09-2026, 09:35\tCOACH/BERTH\tRAC/A2 / 17
PAYMENT STATUS\tONLINE\tStation Code/Name\tCNB / KANPUR CENTRAL
Order Item Details:
Item\tDescription\tPrice\tQuantity\tAmount
Aalu Paratha with Chhole Combo\tAalu paratha 2pcs Chole Chilli sauce Tomato sauce Salad Pickle Spoon Tissue paper\t₹ 225\t1\t₹ 225
Paneer Paratha With Curd Combo\tPaneer paratha 2pcs Curd dahi Chilli sauce Tomato sauce Salad Pickle Spoon Tissue paper\t₹ 225\t1\t₹ 225
Sub Total\t₹ 450
GST\t₹ 22.50
DISCOUNT\t₹ 0
Grand Total (Inclusive of all taxes)\t₹ 473
Warm Regards,
YATRI RESTRO`

/** Same as SAMPLE, but with a real populated DELIVERY DATE value. */
export const SAMPLE_WITH_DELIVERY_DATE = `Order Booking Confirmation
Dear aman,

Order details:
ORDER No\t1000085034\tMOBILE NO\t8789151114
CUSTOMER NAME\taman\tTRAIN No /NAME\t22465 / BABA B DHAM EXP
DELIVERY DATE\t01-09-2026, 11:19\tCOACH/BERTH\tA1 / 21
PAYMENT STATUS\tCASH_ON_DELIVERY\tStation Code/Name\tDDU / PT.DEEN DAYAL UPADHYAYA JN.
Outlet Name\tTHE CHINESE HUB\tOutlet Contact\t9264296066
Order Item Details:
Item\tDescription\tPrice\tQuantity\tAmount
Chicken lollipop Fry 4pc\t4pc\t₹ 216\t1\t₹ 216
Sub Total\t₹ 216
GST\t₹ 10.8
Discount\t₹ 0
Grand Total (Inclusive of all taxes)\t₹ 227
Warm Regards,
YATRI RESTRO`

/**
 * The vendor's OTHER real template: sent directly (not forwarded) from
 * support@yatrirestro.com, addressed to the outlet itself — "Dear Partner,
 * please prepare order and deliver on time." Header is "Order Confirmation",
 * not "Order Booking Confirmation", and it carries no Outlet Name/Outlet
 * Contact row at all. Must still be recognised and parsed as far as
 * possible — it fails closed on MISSING_FIELD for the outlet, not
 * PARSE_FAILED/unrecognised, so a human resolving it in the unparsed inbox
 * sees every other field already extracted.
 */
export const SAMPLE_PARTNER_NO_OUTLET = `Order Confirmation
Dear Partner,
Please prepare order and deliver order on time.

Order details:
ORDER No\t1000591444\tMOBILE NO\t7001349341
CUSTOMER NAME\tANIKET PATRA\tTRAIN No /NAME\t12815 / NANDANKANAN SF
DELIVERY DATE\t01-09-2026, 11:19\tCOACH/BERTH\tB2 / 21
PAYMENT STATUS\tCASH_ON_DELIVERY\tStation Code/Name\tCNB / KANPUR CENTRAL
Order Item Details:
Item\tDescription\tPrice\tQuantity\tAmount
Veg Mini Thali\tSeasonal veg dal fry Jeera rice Tava roti 3pcs Salad Pickle Gulab jamun Spoon Tissue paper\t₹ 180\t1\t₹ 180
Sub Total\t₹ 180
GST\t₹ 9.00
DISCOUNT\t₹ 0
Grand Total (Inclusive of all taxes)\t₹ 189

Warm Regards,
YATRI RESTRO

This is a system generated email. Please do not reply to this email ID. If you have a query or need any clarification you may contact us using any of the communication medium described below:
1. Please confirm train time. Delivery Time may be vary.
2. Call our 24-hour Customer Care at 9264296066
3. Email Us support@yatrirestro.com`

/**
 * The real shape this arrives in: a manual Gmail "Fwd:" wrapper (with its own
 * From/Date/Subject/To header block) around the vendor's HTML, plus the
 * vendor's own footer disclaimer — which names its email domain,
 * "support@yatrirestro.com". That domain contains "yatrirestro" as one
 * unbroken word and used to false-match YatriRestroParser's loose fallback
 * regex before it was tightened, which intercepted this email, failed to
 * parse it, and never let this parser see it at all.
 */
export const SAMPLE_FORWARDED = `---------- Forwarded message ---------
From: <support@yatrirestro.com>
Date: Sun, 1 Mar, 2026, 6:43 pm
Subject: Yatri Restro - Order Booked Successfully
To: <ak4837707@gmail.com>


Order Booking Confirmation
Dear ayush kumar,
Your order has been booked now. Be relaxed and enjoy your journey. We will deliver your order at your seat. Please find the order details below:

Order details:
ORDER No\t1000373994\tMOBILE NO\t6205228491
CUSTOMER NAME\tayush kumar\tTRAIN No /NAME\t13350 / PNBE SGRL EXP
DELIVERY DATE\t\tCOACH/BERTH\tB1 / 19
PAYMENT STATUS\tCASH_ON_DELIVERY\tStation Code/Name\tGAYA / GAYA JN
Outlet Name\tThe fast food king\tOutlet Contact\t9264296066
Order Item Details:
Item\tDescription\tPrice\tQuantity\tAmount
Veg deluxe Thali\tPaneer butter masala,Mix veg,Dal fry/Dal tadka,Jeera Rice,Butter Roti(3pcs),Salad,Pickle,Sweet,Cutlery\t₹ 323\t1\t₹ 323
Sub Total\t₹ 323
GST\t₹ 16.15
Discount\t₹ 0
Grand Total (Inclusive of all taxes)\t₹ 339

Warm Regards,
YATRI RESTRO

This is a system generated email. Please do not reply to this email ID. If you have a query or need any clarification you may contact us using any of the communication medium described below:
1. Please confirm train time. Delivery Time may be vary.
2. Call our 24-hour Customer Care at 9264296066
3. Email Us support@yatrirestro.com`
