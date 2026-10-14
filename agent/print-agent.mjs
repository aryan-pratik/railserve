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
 * Loop: ask the server "any print jobs for me?" (SERVER_URL + AGENT_TOKEN
 * identify the station), send them to the printer, and tell the server each
 * one is done. The server holds that request open until a ticket is queued,
 * so a ticket starts printing the moment it exists rather than at the next
 * poll; a server too old to hold it answers at once and the agent waits
 * POLL_INTERVAL_MS before asking again.
 *
 * Two ways to reach the printer, and a device uses exactly one:
 *   PRINTER_QUEUE  the name of a printer already installed on this computer
 *                  (macOS/Linux, `lpstat -p`). Everything one poll returns
 *                  goes to that queue as ONE raw job, each ticket followed by
 *                  its own cut. Works over Wi-Fi or USB and needs no IP, so
 *                  prefer it on any computer that can already print.
 *   PRINTER_HOST   the printer's local IP, for a device with no installed
 *                  printer. Each ticket is its own connection to port 9100.
 *
 * Config (env vars, or a .env file next to this script — see .env.example):
 *   SERVER_URL        e.g. https://bitestation.elvo.in
 *   AGENT_TOKEN        this station's printAgentToken (Station.printAgentToken)
 *   PRINTER_QUEUE      e.g. POS80 — or leave unset and give PRINTER_HOST
 *   PRINTER_HOST       the printer's local IP, e.g. 192.168.1.5
 *   PRINTER_PORT       default 9100
 *   POLL_INTERVAL_MS   wait between polls when the server can't hold one open, default 3000
 *   CUT_DELAY_MS       PRINTER_HOST only: least time between tickets, default 1500
 *
 * `node print-agent.mjs --test` prints two test tickets the same way a train
 * prints, and exits. They must come out as two separate pieces; it needs only
 * the printer settings.
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
// PRINTER_HOST only. Least time between sending one ticket and the next, so
// the printer finishes printing and cutting it first; without it consecutive
// tickets can run together on one long strip. The queue path doesn't need it:
// there the cut travels inside the job's own bytes.
const CUT_DELAY_MS = Number(process.env.CUT_DELAY_MS ?? '1500')
/**
 * How long the print queue may go without finishing a job before the printer
 * is taken to be off, plus PER_TICKET_MS for every ticket in that job: a long
 * train in one job takes a while to print, and must not be cancelled half way.
 */
const QUEUE_TIMEOUT_MS = 30000
const PER_TICKET_MS = 5000
/** How long the server is asked to hold a poll open, and the most jobs it may hand out at once. */
const POLL_WAIT_S = 20
const POLL_MAX_JOBS = 12
// Longer than the server's hold, by a margin: a job the server claims into a
// request this side has already dropped would never print.
const POLL_TIMEOUT_MS = (POLL_WAIT_S + 20) * 1000

const where = PRINTER_QUEUE ? `queue ${PRINTER_QUEUE}` : `${PRINTER_HOST}:${PRINTER_PORT}`

function required(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Set it in the environment or in agent/.env — see .env.example.`)
    process.exit(1)
  }
  return value
}

/** Resolves with the jobs the server handed out: none, one, or a whole train. */
async function pollOnce() {
  const url = new URL('/api/print-agent/poll', SERVER_URL)
  url.searchParams.set('wait', String(POLL_WAIT_S))
  url.searchParams.set('max', String(POLL_MAX_JOBS))
  const res = await fetch(url, {
    headers: { 'x-agent-token': AGENT_TOKEN },
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`)
  const body = await res.json()
  if (!body.ok) throw new Error(`poll failed: ${body.error}`)
  // `jobs` is the batch; a server from before batching sends only `job`.
  return body.jobs ?? (body.job ? [body.job] : []) // [{ id, images: string[] (base64) }]
}

/** Never throws: a lost ack leaves the job `claimed`, which is not worth stopping the loop for. */
async function ack(jobId, status, error) {
  try {
    const res = await fetch(new URL('/api/print-agent/ack', SERVER_URL), {
      method: 'POST',
      headers: { 'x-agent-token': AGENT_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, status, error }),
    })
    if (!res.ok) console.error(`ack(${jobId}, ${status}) failed: HTTP ${res.status}`)
  } catch (err) {
    console.error(`ack(${jobId}, ${status}) failed: ${err instanceof Error ? err.message : err}`)
  }
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
 * Hands tickets to the computer's print queue as ONE raw job, and resolves as
 * soon as the queue has taken it — not when it has printed. `printed`
 * settles when it has.
 *
 * The printer driver cuts once per job and nowhere else, which is why a
 * browser print of a whole train comes out as one uncut strip. `-o raw`
 * skips the driver, so the only cuts are the ones in these bytes: one after
 * every ticket (see composeTickets).
 *
 * One job for the batch rather than one per ticket because the queue spends
 * a few seconds on every job beyond the printing itself — about five, at
 * Kanpur — and a train of four orders is eight tickets.
 */
async function sendToQueue(bytes, tickets) {
  const out = await run('lp', ['-d', PRINTER_QUEUE, '-o', 'raw', '-t', 'RailServe KOT'], bytes)
  const id = /request id is (\S+)/.exec(out)?.[1]
  if (!id) throw new Error(`lp gave no job id: ${out.trim()}`)

  const printed = new Promise((resolve, reject) => {
    inQueue.push({ id, tickets, sentAt: Date.now(), resolve, reject })
  })
  watchQueue()
  return { printed }
}

/** Jobs handed to the print queue and not yet printed, oldest first. */
const inQueue = []
let watching = false

/**
 * Settles each queued job once the queue has finished with it, while the
 * agent carries on fetching the next tickets.
 *
 * Fails a job the queue sits on for too long rather than leaving it there: a
 * printer that is off would otherwise hold the ticket and print it hours
 * later, when somebody turns it back on. Everything behind it goes too, since
 * it is stuck behind the same printer.
 */
async function watchQueue() {
  if (watching) return
  watching = true
  let progressAt = Date.now()
  try {
    while (inQueue.length > 0) {
      await sleep(250)
      // Only jobs queued before this lpstat ran can be judged by its answer;
      // one queued while it ran would be missing from it, not finished.
      const checking = inQueue.slice()
      const waiting = await run('lpstat', ['-W', 'not-completed', '-o', PRINTER_QUEUE]).catch(() => null)
      if (waiting !== null) {
        const notDone = new Set(waiting.split('\n').map((line) => line.split(/\s/)[0]))
        for (const job of checking) {
          if (notDone.has(job.id)) continue
          inQueue.splice(inQueue.indexOf(job), 1)
          job.resolve()
          progressAt = Date.now()
        }
      }
      if (inQueue.length === 0) break

      const head = inQueue[0]
      const allowed = QUEUE_TIMEOUT_MS + head.tickets * PER_TICKET_MS
      if (Date.now() - Math.max(progressAt, head.sentAt) < allowed) continue

      const stuck = inQueue.splice(0)
      for (const job of stuck) await run('cancel', [job.id]).catch(() => {})
      // lpstat's second line is the reason ("The printer is not responding.").
      const state = await run('lpstat', ['-p', PRINTER_QUEUE]).catch(() => '')
      const reason = state.trim().split('\n')[1]?.trim() || 'is it switched on?'
      const err = new Error(`printer did not take the ticket within ${allowed / 1000}s: ${reason}`)
      for (const job of stuck) job.reject(err)
      progressAt = Date.now()
    }
  } finally {
    watching = false
  }
}

/**
 * The bytes for one queue job: each `compose` draws one ticket, and every
 * ticket starts clean and ends cut. The printer object only turns content
 * into bytes here; it never connects to anything.
 */
async function composeTickets(composers) {
  const printer = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: 'tcp://127.0.0.1:9100' })
  for (const compose of composers) {
    printer.add(INIT)
    printer.alignCenter()
    await compose(printer)
    printer.add(FEED_AND_CUT)
  }
  return printer.getBuffer()
}

/**
 * PRINTER_HOST only: prints one ticket, cut, and waits out the settle time.
 *
 * One ticket per send, not one send for the whole job. execute() writes
 * whatever's buffered and immediately destroys the connection without
 * waiting for the printer to finish processing it. A single ticket's image
 * clears that race easily; a whole run's tickets bundled into one giant
 * write do not — the connection tears down before the printer has drained
 * and cut the later tickets, so they print back-to-back with no cuts.
 */
async function sendTicket(compose) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${PRINTER_HOST}:${PRINTER_PORT}`,
    options: { timeout: 5000 },
  })
  printer.alignCenter()
  await compose(printer)

  const sentAt = Date.now()
  printer.cut()
  await printer.execute()
  // Let the printer print and cut this ticket before the next one lands.
  await sleep(Math.max(0, CUT_DELAY_MS - (Date.now() - sentAt)))
}

/**
 * Prints what one poll returned and acks each job. On the queue path this
 * returns once the batch is queued, so the next poll runs while it prints.
 */
async function printJobs(jobs) {
  const receivedAt = Date.now()
  for (const job of jobs) console.log(`[print-agent] job ${job.id}: ${job.images.length} ticket(s)`)
  const printed = (job) =>
    console.log(`[print-agent] job ${job.id}: printed (${Date.now() - receivedAt}ms)`)
  const failed = (job, err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[print-agent] job ${job.id}: failed — ${message}`)
    return ack(job.id, 'failed', message)
  }

  if (PRINTER_QUEUE) {
    const images = jobs.flatMap((job) => job.images.map((b64) => Buffer.from(b64, 'base64')))
    const composers = images.map((image) => (printer) => printer.printImageBuffer(image))
    try {
      const { printed: done } = await sendToQueue(await composeTickets(composers), images.length)
      done.then(
        () => Promise.all(jobs.map((job) => (printed(job), ack(job.id, 'done')))),
        (err) => Promise.all(jobs.map((job) => failed(job, err))),
      )
    } catch (err) {
      await Promise.all(jobs.map((job) => failed(job, err)))
    }
    return
  }

  for (const job of jobs) {
    try {
      for (const b64 of job.images) {
        await sendTicket((printer) => printer.printImageBuffer(Buffer.from(b64, 'base64')))
      }
      printed(job)
      await ack(job.id, 'done')
    } catch (err) {
      await failed(job, err)
    }
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
  const startedAt = Date.now()
  const ticket = async (printer, n) => {
    printer.bold(true)
    printer.println('RailServe print agent')
    printer.bold(false)
    printer.println(`Test ticket ${n} of 2`)
    await printer.printImageBuffer(TEST_IMAGE)
    printer.println('These two tickets must come out')
    printer.println('as two separate pieces.')
  }

  if (PRINTER_QUEUE) {
    // The way a train prints: both tickets in one queue job, each cut.
    const bytes = await composeTickets([1, 2].map((n) => (printer) => ticket(printer, n)))
    const { printed } = await sendToQueue(bytes, 2)
    console.log(`[print-agent] test: queued (${Date.now() - startedAt}ms)`)
    await printed
  } else {
    for (const n of [1, 2]) await sendTicket((printer) => ticket(printer, n))
  }
  console.log(`[print-agent] test: 2 tickets printed (${Date.now() - startedAt}ms)`)
}

// Said once per change, not once per poll: an agent left offline overnight
// would otherwise write the same line to its log every three seconds.
let lastPollError = 'not connected yet'

async function main() {
  console.log(`[print-agent] polling ${SERVER_URL}, printer ${where}`)
  for (;;) {
    const askedAt = Date.now()
    try {
      const jobs = await pollOnce()
      if (lastPollError) {
        lastPollError = ''
        console.log('[print-agent] connected to server')
      }
      if (jobs.length > 0) {
        await printJobs(jobs)
        continue
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message !== lastPollError) console.error('[print-agent] poll error:', message)
      lastPollError = message
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    // An empty answer that came back at once is a server that can't hold a
    // poll open: pace the asking, as before.
    if (Date.now() - askedAt < 1000) await sleep(POLL_INTERVAL_MS)
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
