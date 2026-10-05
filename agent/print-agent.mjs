#!/usr/bin/env node
/**
 * Runs in the kitchen, on the same Wi-Fi as the printer — not on the app
 * server. The server can't reach the printer's private IP (it's a data-
 * center VM, the printer is on the outlet's own router); this is the one
 * piece that stands on the printer's side of that gap.
 *
 * Deliberately dependency-light and self-contained (no Next.js, no
 * mongoose, no app secrets) — it only needs node-thermal-printer, so it can
 * be copied to whatever small always-on device sits in the kitchen without
 * dragging the rest of the app along.
 *
 * Loop: ask the server "any print job for me?" (SERVER_URL + AGENT_TOKEN
 * identify the outlet), and if there's one, send it to the printer and tell
 * the server it's done.
 *
 * Two ways to reach the printer, and a device uses exactly one:
 *   PRINTER_QUEUE  the name of a printer already installed on this computer
 *                  (macOS/Linux, `lpstat -p`). Each ticket goes to that queue
 *                  as its own raw job. Works over Wi-Fi or USB and needs no
 *                  IP, so prefer it on any computer that can already print.
 *   PRINTER_HOST   the printer's local IP, for a device with no installed
 *                  printer. Each ticket is its own connection to port 9100.
 *
 * Config (env vars, or a .env file next to this script — see .env.example):
 *   SERVER_URL        e.g. https://bitestation.elvo.in
 *   AGENT_TOKEN        this station's printAgentToken (Station.printAgentToken)
 *   PRINTER_QUEUE      e.g. POS80 — or leave unset and give PRINTER_HOST
 *   PRINTER_HOST       the printer's local IP, e.g. 192.168.1.5
 *   PRINTER_PORT       default 9100
 *   POLL_INTERVAL_MS   default 3000
 *   CUT_DELAY_MS       least time between one ticket and the next, default 1500
 *
 * `node print-agent.mjs --test` prints two test tickets and exits. They must
 * come out as two separate pieces; it needs only the printer settings.
 */
import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Every line carries the computer's own date and time: the log is what gets
// read when printing has stopped, and "when did it stop" is the first question.
function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}
for (const level of ['log', 'error']) {
  const write = console[level].bind(console)
  console[level] = (...args) => write(stamp(), ...args)
}

const dir = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(dir, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

const TEST_ONLY = process.argv.includes('--test')

const SERVER_URL = TEST_ONLY ? '' : required('SERVER_URL')
const AGENT_TOKEN = TEST_ONLY ? '' : required('AGENT_TOKEN')
const PRINTER_QUEUE = process.env.PRINTER_QUEUE ?? ''
const PRINTER_HOST = PRINTER_QUEUE ? '' : required('PRINTER_HOST')
const PRINTER_PORT = Number(process.env.PRINTER_PORT ?? '9100')
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? '3000')
// Least time between sending one ticket and the next, so the printer
// finishes printing and cutting it first; without it consecutive tickets can
// run together on one long strip.
const CUT_DELAY_MS = Number(process.env.CUT_DELAY_MS ?? '1500')
/** How long the computer's print queue gets to hand one ticket to the printer. */
const QUEUE_TIMEOUT_MS = 30000

const where = PRINTER_QUEUE ? `queue ${PRINTER_QUEUE}` : `${PRINTER_HOST}:${PRINTER_PORT}`

function required(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Set it in the environment or in agent/.env — see .env.example.`)
    process.exit(1)
  }
  return value
}

async function pollOnce() {
  const res = await fetch(new URL('/api/print-agent/poll', SERVER_URL), {
    headers: { 'x-agent-token': AGENT_TOKEN },
  })
  if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`)
  const body = await res.json()
  if (!body.ok) throw new Error(`poll failed: ${body.error}`)
  return body.job // { id, images: string[] (base64) } | null
}

async function ack(jobId, status, error) {
  const res = await fetch(new URL('/api/print-agent/ack', SERVER_URL), {
    method: 'POST',
    headers: { 'x-agent-token': AGENT_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, status, error }),
  })
  if (!res.ok) console.error(`ack(${jobId}, ${status}) failed: HTTP ${res.status}`)
}

/** Runs a command, optionally feeding it stdin, and resolves with its stdout. */
function run(command, args, input) {
  return new Promise((resolve, reject) => {
    // lp and lpstat answer in the system language; their wording is parsed below.
    const child = spawn(command, args, { env: { ...process.env, LC_ALL: 'C' } })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`${command} failed: ${(err || out).trim() || `exit ${code}`}`))
    })
    child.stdin.end(input)
  })
}

// ESC @: start from a clean state. The queue is shared with the computer's
// own printer driver, which leaves its settings behind after every print.
const INIT = Buffer.from([0x1b, 0x40])
// GS V 66 0: feed to the cutter, then partial cut — the command this
// printer's own driver ends a print with, so a ticket is cut exactly the way
// the kitchen already sees a print cut.
const FEED_AND_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00])

/**
 * Hands one ticket to the computer's print queue as a raw job of its own.
 *
 * The printer driver cuts once per job and nowhere else, which is why a
 * browser print of a whole train comes out as one uncut strip. `-o raw`
 * skips the driver, so the only cut is the one in these bytes, and one job
 * per ticket is one cut per ticket.
 *
 * `lp` returns as soon as the job is queued, so this waits for it to leave
 * the queue. A printer that is off would otherwise hold the ticket and print
 * it hours later, when somebody turns it back on.
 */
async function printViaQueue(bytes) {
  const out = await run('lp', ['-d', PRINTER_QUEUE, '-o', 'raw', '-t', 'RailServe KOT'], bytes)
  const jobId = /request id is (\S+)/.exec(out)?.[1]
  if (!jobId) throw new Error(`lp gave no job id: ${out.trim()}`)

  const deadline = Date.now() + QUEUE_TIMEOUT_MS
  for (;;) {
    await sleep(300)
    const waiting = await run('lpstat', ['-W', 'not-completed', '-o', PRINTER_QUEUE])
    if (!waiting.split('\n').some((line) => line.startsWith(`${jobId} `))) return
    if (Date.now() > deadline) break
  }

  await run('cancel', [jobId]).catch(() => {})
  // lpstat's second line is the reason ("The printer is not responding.").
  const state = await run('lpstat', ['-p', PRINTER_QUEUE]).catch(() => '')
  const reason = state.trim().split('\n')[1]?.trim() || 'is it switched on?'
  throw new Error(`printer did not take the ticket within ${QUEUE_TIMEOUT_MS / 1000}s: ${reason}`)
}

/**
 * Prints one ticket, cut, and waits out the settle time.
 *
 * One ticket per send, not one send for the whole job. On the TCP path
 * execute() writes whatever's buffered and immediately destroys the
 * connection without waiting for the printer to finish processing it. A
 * single ticket's image clears that race easily; a whole run's tickets
 * bundled into one giant write do not — the connection tears down before the
 * printer has drained and cut the later tickets, so they print back-to-back
 * with no cuts.
 */
async function sendTicket(compose) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    // Only execute() uses this; on the queue path the printer object is just
    // what turns an image into bytes.
    interface: `tcp://${PRINTER_HOST || '127.0.0.1'}:${PRINTER_PORT}`,
    options: { timeout: 5000 },
  })

  if (PRINTER_QUEUE) printer.add(INIT)
  printer.alignCenter()
  await compose(printer)

  const sentAt = Date.now()
  if (PRINTER_QUEUE) {
    printer.add(FEED_AND_CUT)
    await printViaQueue(printer.getBuffer())
  } else {
    printer.cut()
    await printer.execute()
  }
  // Let the printer print and cut this ticket before the next one lands. The
  // print queue takes a few seconds over each job by itself, so on that path
  // there is usually nothing left to wait.
  await sleep(Math.max(0, CUT_DELAY_MS - (Date.now() - sentAt)))
}

async function printJob(job) {
  for (const b64 of job.images) {
    await sendTicket((printer) => printer.printImageBuffer(Buffer.from(b64, 'base64')))
  }
}

// A 576-dot frame with bars in it. Real tickets are images, so the test must
// put an image through the printer too, not just text.
const TEST_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAkAAAAAwCAAAAADcTJoCAAAAq0lEQVR4Ae3BMRLDAAzDMFr//7Obve6Q01gCSJIk/aHhsUjvDRCkQpAKQSoEqRCkQpAKQSoEqRCkwvDDchtuy224LbfhttyG23IbbsttuC234bbchttyG27Lbbgtt+G2fBsgSIUgFYJUCFIhSIUgFYJUCFIhSIUgFYJUCFIhSIUgFYJUCFIhSIUgFYJUGB6L9N4AQSoEqRCkQpAKQSoEqRCkQpAKQZIkSdIrH9KjDk5QoK1jAAAAAElFTkSuQmCC',
  'base64',
)

async function testPrint() {
  console.log(`[print-agent] test: sending 2 tickets to ${where}`)
  for (const n of [1, 2]) {
    await sendTicket(async (printer) => {
      printer.bold(true)
      printer.println('RailServe print agent')
      printer.bold(false)
      printer.println(`Test ticket ${n} of 2`)
      await printer.printImageBuffer(TEST_IMAGE)
      printer.println('These two tickets must come out')
      printer.println('as two separate pieces.')
    })
    console.log(`[print-agent] test: ticket ${n} sent`)
  }
}

// Said once per change, not once per poll: an agent left offline overnight
// would otherwise write the same line to its log every three seconds.
let lastPollError = 'not connected yet'

async function tick() {
  const job = await pollOnce()
  if (lastPollError) {
    lastPollError = ''
    console.log('[print-agent] connected to server')
  }
  if (!job) return false

  console.log(`[print-agent] job ${job.id}: ${job.images.length} ticket(s)`)
  try {
    await printJob(job)
    await ack(job.id, 'done')
    console.log(`[print-agent] job ${job.id}: printed`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await ack(job.id, 'failed', message)
    console.error(`[print-agent] job ${job.id}: failed — ${message}`)
  }
  return true
}

async function main() {
  console.log(`[print-agent] polling ${SERVER_URL} every ${POLL_INTERVAL_MS}ms, printer ${where}`)
  for (;;) {
    let printedSomething = false
    try {
      printedSomething = await tick()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message !== lastPollError) console.error('[print-agent] poll error:', message)
      lastPollError = message
    }
    // Drain the queue quickly when busy; back off to the normal interval when idle.
    await sleep(printedSomething ? 200 : POLL_INTERVAL_MS)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (TEST_ONLY) {
  testPrint().catch((err) => {
    console.error(`[print-agent] test failed — ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
} else {
  main()
}
