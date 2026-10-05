import net from 'node:net'
import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer'

/**
 * Sends already-rendered ticket images straight to a kitchen printer over the
 * internet, for a station whose router port-forwards its printer to a public
 * IP — no local bridge agent involved. Used instead of the poll/agent path
 * for stations that have a static IP; other stations keep using the agent.
 *
 * One execute() per ticket, not one for the whole job: execute() sends
 * whatever's buffered and immediately destroys the TCP connection without
 * waiting for the printer to finish processing it. A single ticket's image
 * clears that race easily; a whole run's tickets bundled into one giant
 * write do not — the connection tears down before the printer has drained
 * and cut the later tickets, so they print back-to-back with no cuts. See
 * the same fix in agent/print-agent.mjs.
 *
 * The queue now gives every ticket its own job, so this normally sends one
 * image; the pause after each one is for back-to-back jobs, so the next
 * connection never lands while the printer is still taking in the last.
 */
/** How long the printer gets to take in one ticket before the next connection. */
const SETTLE_MS = Number(process.env.CUT_DELAY_MS ?? '1500')

/**
 * Writes the bytes and closes the connection gracefully (FIN, after the
 * write has fully flushed). printer.execute() destroys the socket as soon as
 * the write returns, which can drop the tail of a large raster job — the cut
 * command is the last bytes, so the ticket prints but never cuts.
 */
function sendRaw(data: Buffer, host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => socket.destroy(new Error(`Printer ${host}:${port} timed out`)))
    socket.once('error', reject)
    socket.once('close', () => resolve())
    socket.once('connect', () => socket.end(data))
  })
}

export async function printImagesDirect(
  images: Buffer[],
  host: string,
  port: number,
): Promise<void> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${host}:${port}`,
    options: { timeout: 5000 },
  })

  for (const image of images) {
    printer.clear()
    printer.alignCenter()
    await printer.printImageBuffer(image)
    printer.cut()
    await sendRaw(printer.getBuffer(), host, port, 15000)
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  }
}
