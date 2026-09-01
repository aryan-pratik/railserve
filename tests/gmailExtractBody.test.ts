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
