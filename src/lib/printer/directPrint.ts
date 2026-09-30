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
 */
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
    await printer.execute()
  }
}
