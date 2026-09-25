// Real RailRestro order mails, exactly as the Gmail HTML fallback in
// gmail/client.ts hands them over: the <style> block survives tag-stripping
// and arrives as a CSS blob ahead of the order, so the parser has to find its
// fields in a body whose first 2KB are stylesheet.
//
// SAMPLE_1 is the plain shape. SAMPLE_2 is the same template carrying two
// items and an extra "Discount"/"Final Total" pair that SAMPLE_1 has no rows
// for at all — nothing here may key off a fixed line offset.
//
// Column gaps are runs of spaces as received. Were this mail ever to arrive
// as a real HTML table instead, client.ts would turn each </td> into a tab;
// the parser splits on either, so both land the same way.
//
// Customer names, mobile numbers and PNRs are redacted — this repo is public.
// Only the personal values were replaced; every structural detail the parser
// depends on is untouched, including the digit counts the phone and order-id
// patterns match on.
export const SAMPLE_1 = `New Email From Railrestro    /* Take care of image borders and formatting */ img { max-width: 600px; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; } a img { border: none; } table { border-collapse: collapse !important; } #outlook a { padding:0; } .ReadMsgBody { width: 100%; } .ExternalClass {width:100%;} .backgroundTable {margin:0 auto; padding:0; width:100%;} table td {border-collapse: collapse;} .ExternalClass * {line-height: 115%;} /* General styling */ td { font-family: 'Open Sans', sans-serif; color: #6f6f6f; } body { -webkit-font-smoothing:antialiased; -webkit-text-size-adjust:none; width: 100%; height: 100%; color: #6f6f6f; font-weight: 400; font-size: 18px; line-height: 24px; } h1 { margin: 10px 0; } a { color: #27aa90; text-decoration: none; } .force-full-width { width: 100% !important; } .force-width-80 { width: 80% !important; } .body-padding { padding: 0 75px; } .mobile-align { text-align: right; }   @media screen { @import url('https://fonts.googleapis.com/css?family=Open+Sans:400,700'); /* Thanks Outlook 2013! */ * { font-family: 'Open Sans', 'Helvetica Neue', 'Arial', 'sans-serif' !important; } .w280 { width: 280px !important; } }   /* Mobile styles */ @media only screen and (max-width: 480px) { table[class*="w320"] { width: 320px !important; } td[class*="w320"] { width: 280px !important; padding-left: 20px !important; padding-right: 20px !important; } img[class*="w320"] { width: 100px !important; height: 50px !important; } td[class*="mobile-spacing"] { padding-top: 10px !important; padding-bottom: 10px !important; } *[class*="mobile-hide"] { display: none !important; } *[class*="mobile-br"] { font-size: 12px !important; } td[class*="mobile-w20"] { width: 20px !important; } img[class*="mobile-w20"] { width: 20px !important; } td[class*="mobile-center"] { text-align: center !important; } table[class*="w100p"] { width: 100% !important; } td[class*="activate-now"] { padding-right: 0 !important; padding-top: 20px !important; } td[class*="mobile-block"] { display: block !important; } td[class*="mobile-align"] { text-align: left !important; } }

        Dear KHANA KHAZANA,
        You have just received a new order, Please ensure delivery on the journey date:
 ORDER #: 5920534  Customer: Test Customer One  M. 9000000001
 TRAIN: 12817 / SWARNJAYANTI EX
 Delivery Time: 2026-09-25 21:16:00
 PNR No.: 1000000001  Coact/Seat: B4-46

            Item Name     Price     Quantity     Total
     Veg Mini Thali     Rs. 164       2
      Rs. 328
            Total:     Rs. 328
            GST:     Rs. 16.4
            Subtotal:     Rs. 344.4
            Extra Charges:     Rs. 0
       Cashback:       Rs. 0.00
       Paid Total:      Rs. 344.4
       (Amount to collect)     Rs. 0/-

 Best Regards,
 RailRestro Team.`

export const SAMPLE_2 = `New Email From Railrestro    /* Take care of image borders and formatting */ img { max-width: 600px; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; } a img { border: none; } table { border-collapse: collapse !important; } #outlook a { padding:0; } .ReadMsgBody { width: 100%; } .ExternalClass {width:100%;} .backgroundTable {margin:0 auto; padding:0; width:100%;} table td {border-collapse: collapse;} .ExternalClass * {line-height: 115%;} /* General styling */ td { font-family: 'Open Sans', sans-serif; color: #6f6f6f; } body { -webkit-font-smoothing:antialiased; -webkit-text-size-adjust:none; width: 100%; height: 100%; color: #6f6f6f; font-weight: 400; font-size: 18px; line-height: 24px; } h1 { margin: 10px 0; } a { color: #27aa90; text-decoration: none; } .force-full-width { width: 100% !important; } .force-width-80 { width: 80% !important; } .body-padding { padding: 0 75px; } .mobile-align { text-align: right; }   @media screen { @import url('https://fonts.googleapis.com/css?family=Open+Sans:400,700'); /* Thanks Outlook 2013! */ * { font-family: 'Open Sans', 'Helvetica Neue', 'Arial', 'sans-serif' !important; } .w280 { width: 280px !important; } }   /* Mobile styles */ @media only screen and (max-width: 480px) { table[class*="w320"] { width: 320px !important; } td[class*="w320"] { width: 280px !important; padding-left: 20px !important; padding-right: 20px !important; } img[class*="w320"] { width: 100px !important; height: 50px !important; } td[class*="mobile-spacing"] { padding-top: 10px !important; padding-bottom: 10px !important; } *[class*="mobile-hide"] { display: none !important; } *[class*="mobile-br"] { font-size: 12px !important; } td[class*="mobile-w20"] { width: 20px !important; } img[class*="mobile-w20"] { width: 20px !important; } td[class*="mobile-center"] { text-align: center !important; } table[class*="w100p"] { width: 100% !important; } td[class*="activate-now"] { padding-right: 0 !important; padding-top: 20px !important; } td[class*="mobile-block"] { display: block !important; } td[class*="mobile-align"] { text-align: left !important; } }

        Dear KHANA KHAZANA,
        You have just received a new order, Please ensure delivery on the journey date:
 ORDER #: 5921034  Customer: Test Customer Two  M. 9000000002
 TRAIN: 12308 / JU HWH SF EXP
 Delivery Time: 2026-09-25 23:00:00
 PNR No.: 1000000002  Coact/Seat: S4-37

            Item Name     Price     Quantity     Total
     Paneer Curry & Rice Combo     Rs. 213       1
      Rs. 213
   Chilli Paneer & Fried Rice Combo     Rs. 213       1
      Rs. 213
            Total:     Rs. 426
            GST:     Rs. 21.3
            Subtotal:     Rs. 447.3
            Extra Charges:     Rs. 0
       Discount     Rs. 21
       Final Total     Rs. 426.3
       Cashback:       Rs. 0.00
       Paid Total:      Rs. 426.3
       (Amount to collect)     Rs. 0/-

 Best Regards,
 RailRestro Tea`
