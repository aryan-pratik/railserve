/**
 * slice bank credit alerts, as they reach the parser.
 *
 * These are HTML mails, so what arrives is extractBody()'s tag-stripped text:
 * the <style> block survives as leading CSS noise and table cells become
 * tabs. Both are reproduced here on purpose — a fixture of the tidy text a
 * human sees would not exercise what the parser actually has to cope with.
 */

/** The shape in the screenshot: label, tab, value. */
export const SAMPLE = `.title, .list-t1, .pointer-label, .pointer-desc { font-size: 12.8px !important; } .footer-main { font-size: 10px !important; } .footer-social img { width: 13px !important; height: 13px !important;} }
Hi Gautam,
  You have received ₹230 via UPI in your slice bank account xx8773. Avl. Bal. ₹3,571.23
     Transaction date	 06-Sep-26
  From	 AMITKUMAR TIWARI
  RRN	 661533935455

  Best,
 Team slice
Digital safety tips
        To talk to us, drop an email to help@slice.bank.in
 © slice small finance bank. All rights reserved.`

/** Same alert, spaces instead of tabs, and a thousands separator on the amount. */
export const SAMPLE_SPACED = `Hi Gautam,
  You have received ₹1,240.50 via UPI in your slice bank account xx8773. Avl. Bal. ₹12,004.73
     Transaction date   31-Dec-25
  From    S RAJESH KUMAR
  RRN     536112090778

  Best,
 Team slice`

/**
 * Forwarded, so the envelope's own From: header sits above the payer's.
 * The first "From" in the body is not the one that means "who paid".
 */
export const SAMPLE_FORWARDED = `---------- Forwarded message ---------
From: slice <no-reply@slice.bank.in>
Date: Sun, 6 Sep 2026 at 19:08
Subject: Money received

Hi Gautam,
  You have received ₹230 via UPI in your slice bank account xx8773. Avl. Bal. ₹3,571.23
     Transaction date	 06-Sep-26
  From	 AMITKUMAR TIWARI
  RRN	 661533935455

 Team slice`

/** The bank stopped quoting a balance. Still a payment; balance is unknown. */
export const SAMPLE_NO_BALANCE = `Hi Gautam,
  You have received ₹500 via UPI in your slice bank account xx8773.
     Transaction date	 06-Sep-26
  From	 MEENA DEVI
  RRN	 661599112233

 Team slice`

/** A template change that drops the reference number — must NOT become a row. */
export const SAMPLE_NO_RRN = `Hi Gautam,
  You have received ₹230 via UPI in your slice bank account xx8773. Avl. Bal. ₹3,571.23
     Transaction date	 06-Sep-26
  From	 AMITKUMAR TIWARI

 Team slice`

/** Money going out. Deliberately not a match — no payer to record. */
export const SAMPLE_DEBIT = `Hi Gautam,
  ₹230 has been debited from your slice bank account xx8773 via UPI. Avl. Bal. ₹3,341.23
     Transaction date	 06-Sep-26
  To	 BHARAT PETROLEUM
  RRN	 661533935999

 Team slice`
