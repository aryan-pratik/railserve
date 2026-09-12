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
 * identify the outlet), and if there's one, send it straight to the
 * printer's local IP and tell the server it's done.
 *
 * Config (env vars, or a .env file next to this script — see .env.example):
 *   SERVER_URL        e.g. https://bitestation.elvo.in
 *   AGENT_TOKEN        this outlet's printAgentToken (Restaurant.printAgentToken)
 *   PRINTER_HOST       the printer's local IP, e.g. 192.168.1.5
 *   PRINTER_PORT       default 9100
 *   POLL_INTERVAL_MS   default 3000
 */
import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

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

const SERVER_URL = required('SERVER_URL')
const AGENT_TOKEN = required('AGENT_TOKEN')
const PRINTER_HOST = required('PRINTER_HOST')
const PRINTER_PORT = Number(process.env.PRINTER_PORT ?? '9100')
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? '3000')

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

async function printJob(job) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${PRINTER_HOST}:${PRINTER_PORT}`,
    options: { timeout: 5000 },
  })
  for (const b64 of job.images) {
    printer.alignCenter()
    await printer.printImageBuffer(Buffer.from(b64, 'base64'))
    printer.cut()
  }
  await printer.execute()
}

async function tick() {
  const job = await pollOnce()
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
  console.log(`[print-agent] polling ${SERVER_URL} every ${POLL_INTERVAL_MS}ms, printer ${PRINTER_HOST}:${PRINTER_PORT}`)
  for (;;) {
    let printedSomething = false
    try {
      printedSomething = await tick()
    } catch (err) {
      console.error('[print-agent] poll error:', err instanceof Error ? err.message : err)
    }
    // Drain the queue quickly when busy; back off to the normal interval when idle.
    await sleep(printedSomething ? 200 : POLL_INTERVAL_MS)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main()
