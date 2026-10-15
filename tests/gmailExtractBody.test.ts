import { describe, expect, it } from 'vitest'
import type { gmail_v1 } from 'googleapis'
import { extractBody } from '../src/lib/ingest/gmail/client'

const htmlPart = (html: string): gmail_v1.Schema$MessagePart => ({
  mimeType: 'text/html',
  body: { data: Buffer.from(html, 'utf8').toString('base64url') },
})

/**
 * A trimmed but faithful reproduction of a real YatriRestro "Order
 * Confirmation" email's HTML, decoded from its actual quoted-printable wire
 * format (pulled from Gmail's "Show original" for order #1000591854).
 *
 * Every <td>/<th> sits on its own source line — ordinary hand-formatted HTML,
 * invisible once rendered, since a browser collapses that whitespace. Without
 * collapsing it here too, the source's own line break survives as a real
 * newline sitting right next to the tab inserted for </td>, and the
 * trailing-whitespace cleanup later in the chain deletes that tab — splitting
 * "Amritsari Thali" onto a line with no delimiter connecting it to anything
 * that follows, and the Grand Total label onto a line disconnected from its
 * own ₹ amount on the next line.
 */
const REAL_TABLE_HTML = `<!DOCTYPE html>
<html><body>
<table>
<tbody>
<tr>
<td width="20%">Item</td>
<td width="35%">Description</td>
<td width="15%">Price</td>
<td width="15%">Quantity</td>
<td width="15%">Amount</td>
</tr>
<tr>
<td width="20%">Amritsari Thali</td>
<td width="35%">Matar paneer Chola dal tadka Jeera rice Butter tawa roti 3pcs Salad Pickle Gulab jamun Spoon Tissue paper
</td>
<td width="15%">₹ 210</td>
<td width="15%"> 2</td>
<td width="15%">₹ 420</td> </tr>
<tr>
<th colspan="4">Grand Total (Inclusive of all taxes)</th>
<th width="20%">₹ 441</th>
</tr>
</tbody>
</table>
</body></html>`

describe('extractBody — HTML table extraction', () => {
  it('keeps a cell and the next one tab-delimited on one line, even when the source puts each <td> on its own line', () => {
    const text = extractBody(htmlPart(REAL_TABLE_HTML))
    // Cell boundaries carry a leading space from the collapsed inter-tag
    // whitespace ("\t Description", not "\tDescription") — harmless, since
    // every consumer trims each cell, but real, so assert it as-is rather
    // than normalizing it away and hiding a future regression there.
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

    const headerLine = lines.find((l) => l.startsWith('Item'))
    expect(headerLine).toBe('Item\t Description\t Price\t Quantity\t Amount')

    const itemLine = lines.find((l) => l.startsWith('Amritsari'))
    expect(itemLine).toBe(
      'Amritsari Thali\t Matar paneer Chola dal tadka Jeera rice Butter tawa roti 3pcs Salad Pickle Gulab jamun Spoon Tissue paper \t ₹ 210\t  2\t ₹ 420',
    )
    expect(itemLine!.split('\t').map((c) => c.trim())).toEqual([
      'Amritsari Thali',
      'Matar paneer Chola dal tadka Jeera rice Butter tawa roti 3pcs Salad Pickle Gulab jamun Spoon Tissue paper',
      '₹ 210',
      '2',
      '₹ 420',
    ])

    const grandTotalLine = lines.find((l) => l.startsWith('Grand Total'))
    expect(grandTotalLine).toBe('Grand Total (Inclusive of all taxes)\t ₹ 441')
  })
})

describe('extractBody — a text/plain part that is really HTML', () => {
  const textPart = (text: string): gmail_v1.Schema$MessagePart => ({
    mimeType: 'text/plain',
    body: { data: Buffer.from(text, 'utf8').toString('base64url') },
  })
  // The shape of RailRestro's multipart mails from 14-Oct-2026: the same HTML
  // document in both alternatives, greeting split across source lines.
  const RAILRESTRO_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html><body><table><tr>
    <td height="30" style="font:14px/16px Arial">Dear
        <b>KHANA KHAZANA</b>,</td>
</tr></table></body></html>`

  it('strips the real HTML alternative instead of returning markup', () => {
    const body = extractBody({
      mimeType: 'multipart/alternative',
      parts: [textPart(RAILRESTRO_HTML), htmlPart(RAILRESTRO_HTML)],
    })
    expect(body).toMatch(/^\s*Dear KHANA KHAZANA,\s*$/m)
    expect(body).not.toContain('<b>')
  })

  it('strips the plain part itself when there is no HTML alternative', () => {
    const body = extractBody({ mimeType: 'multipart/alternative', parts: [textPart(RAILRESTRO_HTML)] })
    expect(body).toMatch(/^\s*Dear KHANA KHAZANA,\s*$/m)
  })

  it('leaves genuine plain text alone, angle brackets and all', () => {
    const plain = 'Dear KHANA KHAZANA,\nFrom: RailRestro <no-reply@railrestro.com>\nAmount < 500'
    const body = extractBody({
      mimeType: 'multipart/alternative',
      parts: [textPart(plain), htmlPart('<p>ignored</p>')],
    })
    expect(body).toBe(plain)
  })
})

describe('toParseableText — a raw RailRestro email pasted or corrected in the inbox', () => {
  // The layout of RailRestro's order mail as stored on a failed inbox row,
  // with invented customer details: greeting split across source lines and
  // every field wrapped in <b>.
  const RAILRESTRO_RAW = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html><head><title>New Email From Railrestro</title><style type="text/css">td { color: #6f6f6f; }</style></head>
<body><table><tr>
    <td><a href="http://railrestro.com/"><img src="https://www.railrestro.com/img/logo.png" alt="RailRestro.com" /></a></td>
</tr><tr>
    <td height="30" bgcolor="#FFFFFF" style="font:14px/16px Arial">Dear
        <b>KHANA KHAZANA</b>,</td>
</tr><tr>
    <td bgcolor="#FFFFFF">You have just received a new
        order, Please ensure delivery on the journey date: <br />
        ORDER #: <b>6000001 </b> Customer: <b>Test Passenger </b> M. <b>9000000000 </b> <br>
                TRAIN: <b>22911 / HWH SHIPRA EXP </b> <br>
        Delivery Time: <b>2026-10-14 23:10:00 </b> <br>
        PNR No.: <b>1234567890 </b> Coact/Seat: <b>M2-46 </b>
        <br>
    </td>
</tr><tr><td><table width="100%">
  <thead><tr><th>Item Name</th><th>Price</th><th>Quantity</th><th>Total</th></tr></thead>
  <tbody>
    <tr><td> Chicken Biryani</td><td>Rs. 262</td><td><div class="">
                2                        </div></td><td>Rs. 524</td></tr>
    <tr><td></td><td></td><td>Total:</td><td><b>Rs. 524</b></td></tr>
    <tr><td></td><td></td><td>Subtotal:</td><td>Rs. 550.2</td></tr>
    <tr><td colspan=2></td><th>Payable Total:</th><td><b>Rs. 550.2</b></td></tr>
    <tr><td colspan=2></td><th><small>(Amount to collect)</small></th><td><b>Rs. 550.2</b></td></tr>
  </tbody>
</table></td></tr></table></body></html>`

  it('turns the stored markup into text the RailRestro parser accepts', async () => {
    const { toParseableText } = await import('../src/lib/ingest/gmail/client')
    const { RailRestroParser } = await import('../src/lib/ingest/parsers/railrestro')
    const parsed = new RailRestroParser().parse(toParseableText(RAILRESTRO_RAW), new Date())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.order.outletName).toBe('KHANA KHAZANA')
    expect(parsed.order.externalOrderId).toBe('6000001')
    expect(parsed.order.trainNo).toBe('22911')
  })

  it('leaves text that is already plain exactly as it was', async () => {
    const { toParseableText } = await import('../src/lib/ingest/gmail/client')
    const plain = 'Dear KHANA KHAZANA,\nORDER #: 6000001'
    expect(toParseableText(plain)).toBe(plain)
  })
})
