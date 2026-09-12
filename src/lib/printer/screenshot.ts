import puppeteer, { type Browser } from 'puppeteer'
import sharp from 'sharp'
import { env } from '@/lib/env'

/**
 * Renders the real KOT page in headless Chrome and screenshots every
 * ticket on it (".kot", from KotTicket.tsx) individually.
 *
 * This is the server-side equivalent of what used to happen when a manager
 * clicked Print and picked the KOT page out of the OS print dialog: the
 * browser rasterised the actual rendered page and the printer driver sent
 * that image to the printer. Doing the same rasterisation here means the
 * print output always matches the screen exactly — including glyphs like ₹
 * and × that the printer's own text firmware can't render — and never needs
 * hand-updating when KotTicket.tsx's layout changes.
 *
 * The printer's `Print Width Dots: 576` (from its self-test page) is the
 * hard constraint: node-thermal-printer sends the image's raw pixel width
 * straight into the ESC/POS raster command with no scaling of its own, so
 * every screenshot is resized to exactly that width before it's handed off.
 */

const PRINTER_DOT_WIDTH = 576

/**
 * Puppeteer's deviceScaleFactor scales rendered pixels without changing CSS
 * layout, so the ticket keeps the exact proportions it has on screen — this
 * just picks the multiplier that lands a "w-[80mm]" element (80mm at the
 * CSS-spec 96px/in) on PRINTER_DOT_WIDTH device pixels.
 */
const CSS_PX_PER_MM = 96 / 25.4
const DEVICE_SCALE_FACTOR = PRINTER_DOT_WIDTH / (80 * CSS_PX_PER_MM)

/**
 * Cached browser, same reasoning as connectDb's cached Mongo connection:
 * launching Chromium is the slow part (~2.5s cold), so it's kept warm across
 * requests — and across Next.js dev's hot-reloads, via globalThis — rather
 * than paying that cost on every single print. Only the (cheap) page is
 * created and closed per job.
 */
const globalForBrowser = globalThis as unknown as { __railserveBrowser?: Promise<Browser> }

async function getBrowser(): Promise<Browser> {
  if (!globalForBrowser.__railserveBrowser) {
    globalForBrowser.__railserveBrowser = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
  }
  const browser = await globalForBrowser.__railserveBrowser
  // A crashed or manually-closed browser leaves a dead reference behind —
  // relaunch rather than fail every print until the process restarts.
  if (!browser.connected) {
    globalForBrowser.__railserveBrowser = undefined
    return getBrowser()
  }
  return browser
}

/**
 * @param pageUrl One of the /internal/print/* pages — token-gated, no login
 *   session involved (see printer/internalAuth.ts). Works equally whether
 *   the print was triggered by a click or by server-side logic with no
 *   request/cookie context at all.
 * @returns One PNG buffer per ticket on the page, in document order.
 */
export async function renderKotScreenshots(pageUrl: string): Promise<Buffer[]> {
  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    await page.setExtraHTTPHeaders({ 'x-print-render-token': env.PRINT_RENDER_TOKEN })
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: DEVICE_SCALE_FACTOR })
    await page.goto(pageUrl, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.kot')

    const tickets = await page.$$('.kot')
    if (tickets.length === 0) throw new Error('No .kot ticket found on the print page')

    const images: Buffer[] = []
    for (const ticket of tickets) {
      const raw = await ticket.screenshot({ type: 'png' })
      const resized = await sharp(raw).resize({ width: PRINTER_DOT_WIDTH }).png().toBuffer()
      images.push(resized)
    }
    return images
  } finally {
    await page.close()
  }
}
