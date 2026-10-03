# KOT printing — setup & reference

## Why this exists
- Kitchen printer (KPC307-UEWB-AB28) sits on the outlet's local Wi-Fi, private IP.
- App server (Contabo VM) is in a data center — cannot reach a private LAN IP directly.
- Two fixes, and a station uses exactly one of them:
  - **Agent path** (default) — a small **print agent** runs on a device at the
    outlet and bridges cloud → local printer.
  - **Direct path** — where the outlet has a public address and a router we
    control, the printer's port is forwarded and the server prints straight to
    it. No device in the kitchen. See
    [Direct printing](#direct-printing--when-the-printer-has-a-public-address).

## One station, one printer, one agent
- A `Restaurant` is an **aggregator brand**, not a kitchen. YATRI BHOJAN and
  YATRI RESTRO at Kanpur Central are two sets of paperwork and one stove.
- So the printer belongs to the **station**: `Station.printAgentToken`, one
  agent, and every brand's tickets come off it. Each ticket prints its brand
  name at the top so the kitchen can tell them apart.
- Orders for other stations never reach that printer — a token only ever
  claims jobs whose `stationCode` matches.
- Adding a brand at a station that already prints needs **no printer setup at
  all**: create the `Restaurant`, and its orders join the existing queue.

## Architecture
```
Manager clicks "Generate KOT" (or Print)
  → server renders the real KotTicket component via headless Chrome (screenshot, not hand-typed text)
  → image saved as a PrintJob in MongoDB, status "pending"
  │
  ├─ station has NO directPrinterHost  (agent path — the default)
  │    → outlet's print agent polls /api/print-agent/poll every few seconds
  │    → agent claims the job, sends image to printer's local IP:9100 (ESC/POS raster)
  │    → agent calls /api/print-agent/ack (done/failed)
  │
  └─ station HAS directPrinterHost  (direct path)
       → tryDirectDeliver() opens host:port from the server, in the same request
       → on success: job "done"; on failure: job stays "pending" with `error` set
       → /api/cron/print-retry sweeps anything left pending
```
- On the **agent path** the server never talks to the printer — it cannot, from
  a data-center VM, reach a private LAN IP. Only the agent does.
- On the **direct path** it is the server that talks to the printer, over the
  internet, because the router has given the printer a public address.
- Agent-path stations each need their own printer + agent + token. A
  direct-path station needs **no agent and no `printAgentToken` at all** —
  don't mint one it will never use.
- Either way the routing key is the same: a job belongs to a `stationCode`, and
  a station only ever gets its own jobs.

## Direct printing — when the printer has a public address

Where an outlet has a static public IP and a router we control, the last hop
needs no bridge: the router forwards the printer's `9100` to the public
address and the server opens that socket itself.

Setting `Station.directPrinterHost` is the whole switch. Nothing else changes —
same ticket, same `PrintJob`, same buttons. The station stops needing an agent
the moment the field is set.

Use it when the outlet has a **static** public IP and somebody can administer
the router. Use the agent path for everything else: a dynamic IP, a router we
don't control, or a network where exposing a port is not acceptable.

### How it works
- `tryDirectDeliver()` (`src/lib/printer/queue.ts`) runs immediately after the
  `PrintJob` is saved, in the same request that pressed the button. It looks up
  the station, and returns doing nothing if `directPrinterHost` is null — which
  is what keeps every agent-path station on its old behaviour.
- On success the job goes `done` and `Station.agentLastPrintedAt` is stamped,
  the same field the agent path stamps on ack.
- On failure it **does not throw**. The job is left `pending` with the error
  message in `PrintJob.error`, and the caller's print click still succeeds — a
  printer being briefly unreachable is not a reason to fail an order action.
- `/api/cron/print-retry` is the safety net: it re-attempts every `pending` job
  belonging to a direct-path station. Agent-path stations are left strictly
  alone, since their agent will claim those jobs on its own next poll.
- The direct path never sets status `failed`. Jobs go `pending` → `done` only,
  so **`error` on a still-`pending` job is the only failure signal** — that is
  the field to read when a ticket doesn't come out.
- `agentLastSeenAt` stays null forever on a direct-path station. There is no
  poll, so there is no heartbeat; that field means "an agent called in" and
  only applies to agent-path stations.
- `printImagesDirect()` sends **one `execute()` per ticket**, not one per job.
  `execute()` destroys the TCP connection as soon as it has written, without
  waiting for the printer to drain — bundle a whole run into one write and the
  later tickets print back-to-back with no cuts. Same fix lives in
  `agent/print-agent.mjs`. Both also pause 500ms after each ticket so the next
  connection doesn't land while the printer is still taking in the last one.
- The queue itself now creates **one `PrintJob` per ticket** (each order prints
  a KOT and a bag slip, so two jobs per order). A one-ticket job is cut on its
  own whatever agent version a kitchen is running, which is what fixed train
  batches coming out as one uncut strip.

### Connecting a printer this way (per station)
1. Do the [physical printer setup](#one-time-printer-setup-per-printer) steps
   1–8 exactly as for the agent path, **including the DHCP reservation**. The
   port forward points at a LAN IP, so that IP must not move.
2. On the outlet's router, forward a TCP port to the printer:
   `<external port> → <printer LAN IP>:9100`.
3. **Restrict the forward's source to the app server's IP** in the router's
   firewall. See the security note below — this step is not optional.
4. Check the socket from the app server (not from a laptop — if step 3 is done
   right, everywhere else is supposed to fail):
   ```
   nc -vz <public host> <external port>
   ```
5. Point the station at it. There is **no script and no admin UI for this yet** —
   it is a direct Mongo update on the box:
   ```
   docker exec -it railserve-mongo mongosh railserve --eval '
     db.stations.updateOne(
       { _id: "<STATION CODE>" },
       { $set: { directPrinterHost: "<public host or IP>", directPrinterPort: <external port> } }
     )
   '
   ```
   Leave the port **unquoted** — the schema wants a Number, and a raw driver
   update like this one does no Mongoose casting, so `"9100"` would be stored
   as a string and never connect. `directPrinterPort` is the **external**
   forwarded port, not the printer's own `9100`, unless the forward happens to
   keep the number. It defaults to `9100` when unset.
6. Print a test KOT from that station and confirm the job went `done`.

To move a station back to the agent path, set `directPrinterHost` to `null` and
set up an agent as normal. Real hosts and ports belong in `docs/INFRA.local.md`,
never here — **this repo is public**.

### Security
A forwarded `9100` is a raw ESC/POS socket on the open internet. Anyone who
finds it can print whatever they like on the kitchen's printer, burn its paper,
or wedge it. Two mitigations, both required:
- **Source-restrict the forward to the app server's IP** in the router
  firewall. This is the one that actually matters.
- **Use a non-default external port.** `9100` is in every scanner's default
  list; it buys time, not safety, and does not replace the rule above.

### Two behaviours to expect, neither a bug
- **A failed ticket reprints alone.** Every ticket is its own job, so a run
  that dies on ticket 3 of 5 retries ticket 3 onwards, not the whole train.
  (Jobs queued before that change could hold several images and still reprint
  whole.)
- **The sweep has no age cap.** `retryDirectPrintJobs()` takes *every* pending
  job for a direct station with no time bound. A printer that is off overnight
  will print the whole backlog when it comes back. If that bites, the fix is a
  `createdAt` floor in that query.

## One-time printer setup (per printer)
1. Power on, load paper.
2. Connect to printer's own hotspot: Wi-Fi `KPC307-UEWB-AB28`, password `88888888`.
3. Browser → `http://192.168.223.1`.
4. **WiFi tab**: set `STA SSID` / `STA PSK` to the outlet's real Wi-Fi + password → Set.
5. **Network tab**: switch mode to **STA** (client) → Set.
6. Reconnect your device to the outlet's normal Wi-Fi.
7. Hold printer's feed button ~3s → prints self-test page → note `STA IP` (= `PRINTER_HOST`) and MAC.
8. On the outlet's router: set a **DHCP reservation** for that MAC so the IP never changes.

## One-time app setup (per station)
```
npm run print-agent:token -- --station CNB
# --rotate to replace an existing token
```
- Generates/reads `Station.printAgentToken`. Copy the printed `AGENT_TOKEN`.
- Rotating stops that kitchen printing until somebody edits `agent/.env` on the
  device there and restarts the agent.

## One-time agent setup (per outlet, on one always-on device there)
```
cd agent
npm install
cp .env.example .env
```
Fill `agent/.env`:
```
SERVER_URL="https://bitestation.elvo.in"   # or http://localhost:3000 for local dev
AGENT_TOKEN="<from token step above>"
PRINTER_HOST="<STA IP from printer setup>"
PRINTER_PORT="9100"
POLL_INTERVAL_MS="3000"
```
Run:
```
npm start
```
- Register as a system service (systemd/pm2/launchd) so it survives reboots — don't leave it in a bare terminal.
- Device just needs to be on the outlet's Wi-Fi. Doesn't need to be the staff's daily-use tab/laptop.
- Can be powered on/off with the kitchen's operating hours — no need for 24/7 if not wanted.

## Local dev / testing (no separate device)
- Run the agent on the same machine as the app: `SERVER_URL="http://localhost:3000"` in `agent/.env`.
- Multiple test outlets on one laptop with one physical printer → run multiple agent instances at once, one per outlet's token, all pointing at the same `PRINTER_HOST`.

## Required env vars (app server)
```
PRINT_RENDER_TOKEN="<random secret>"   # generate: node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```
- Guards `/internal/print/*` (the pages the headless-browser screenshot step renders).
- Missing → print button/auto-print returns a clear 503, not a silent failure.

```
CRON_TOKEN="<random secret>"   # only if any station prints directly
```
- Gates `/api/cron/print-retry` (and the other `/api/cron/*` endpoints) — see
  `docs/DEPLOY.md` for the crontab entry. Leave it blank and the endpoint is
  open to anyone; set it and it must match what the cron runner sends, or every
  tick 401s silently and pending jobs are never retried.

## When printing happens
- Two separate, always-visible controls — neither one ever navigates away from the page:
  - **Preview KOT** — plain link to the KOT page. Read-only, never queues a print. Available from `ACCEPTED` onward, so a ticket can be checked before it's ever generated.
  - **Generate KOT** / **Reprint KOT** — the one button that actually prints. Same component, relabels itself:
    - `ACCEPTED`: labelled **Generate KOT** — runs the delay guard, transitions `ACCEPTED → KOT_PRINTED`, auto-queues the print. Fires once per transition, not on repeat clicks.
    - `KOT_PRINTED` / `PREPARED`: labelled **Reprint KOT** — no transition (already done), no delay guard (already answered once), calls the same enqueue route directly (`POST /api/store/orders/[id]/kot`) and can be clicked as many times as needed.
  - Same pattern on the `/store` board for a whole train batch: **Preview N KOTs** + **Print/Reprint N KOTs**.
- Print failures never block the order status change — logged, workflow continues, Reprint is the fallback.
- Components: `PreviewKotLink` and `GenerateKotButton` (`isReprint` prop) in `src/app/store/StoreOrderActions.tsx`; the run/batch equivalents in `src/app/store/StoreRunActions.tsx`.

## Key files
| Path | What |
|---|---|
| `agent/print-agent.mjs` | Standalone agent script. Deploy this + `agent/package.json` to the outlet's bridge device. |
| `agent/README.md` | Agent-specific setup notes. |
| `scripts/set-print-agent-token.ts` | Mint/rotate an outlet's agent token. |
| `src/lib/models/PrintJob.ts` | The print queue (Mongo). |
| `src/lib/models/Station.ts` | The station: `printAgentToken`, `agentLastSeenAt`, and `directPrinterHost`/`directPrinterPort` — the one field that chooses the delivery path. One per printer. |
| `scripts/migrate-station-printing.ts` | Moves the token from outlet to station. Idempotent; adopts a live token so the kitchen needs no reconfiguration. |
| `src/lib/printer/screenshot.ts` | Headless-Chrome screenshot of the real ticket → PNG, resized to the printer's `576` dot width. |
| `src/lib/printer/queue.ts` | Enqueue helpers (`enqueueOrderKotPrint`, `enqueueRunKotPrint`), plus `tryDirectDeliver` / `retryDirectPrintJobs` for the direct path. |
| `src/lib/printer/directPrint.ts` | `printImagesDirect` — server → printer over TCP, for direct-path stations. No agent involved. |
| `src/app/api/cron/print-retry` | Re-attempts pending jobs for direct-path stations. Cron-token auth; ignores agent-path stations. |
| `src/app/internal/print/order/[id]`, `.../run/[runKey]` | Token-gated, session-free render-only pages the screenshot step hits. |
| `src/app/api/print-agent/poll`, `/ack` | What the agent calls. Token-authenticated, no login session. |
| `src/app/api/store/orders/[id]/kot`, `.../runs/[runKey]/kot` | Manual print trigger (the Print button). |
| `src/app/store/actions.ts` | `generateKot` / `generateRunKot` — auto-print hook. |

## Troubleshooting
- **Nothing prints, no error shown, agent-path station**: check the agent is actually running (`ps aux | grep print-agent`) and its `AGENT_TOKEN` is the one minted for the order's **station** — a mismatched token means the job just sits `pending` forever, silently.
- **Job stuck `pending`, agent-path station**: query the `printjobs` collection and check `stationCode` matches a station whose agent is currently polling (`agentLastSeenAt` recent).
- **Job stuck `pending`, direct-path station**: read that job's **`error`** field — the direct path never writes status `failed`, so a pending job with an error is a delivery that failed, not one nobody has claimed. Then check, in order: the printer is on and on the network, `nc -vz <host> <port>` from the app server, and that the `print-retry` cron line actually exists in the crontab (`docs/DEPLOY.md`) and its token matches `CRON_TOKEN`.
- **Nothing prints at a direct-path station and jobs have no `error` at all**: `directPrinterHost` is probably unset or misspelled — the job was queued for an agent that does not exist. Check `db.stations.findOne({_id:"<CODE>"})`.
- **Tickets print back-to-back with no cuts**: check the `printjobs` for that run each hold one image (`enqueueTickets` in `src/lib/printer/queue.ts`). If they do, something has collapsed the per-ticket `execute()` — see `printImagesDirect` and `agent/print-agent.mjs`, both deliberately execute once per ticket.
- **Duplicate tickets after an outage**: rare now that every ticket is its own job; see [Two behaviours to expect](#two-behaviours-to-expect-neither-a-bug).
- **Schema/field changes to `Restaurant` or `PrintJob` not taking effect after a dev-server restart**: Turbopack's `.next` cache can serve a stale compiled model. Fix: `rm -rf .next` then `npm run dev`.
- **`printJobId not found or not claimed by you`** on ack: another agent instance (wrong token, or a duplicate process) already claimed it first — check for duplicate agent processes.
- **Print looks different from the screen**: shouldn't happen — it's a screenshot of the real `KotTicket` component, not a hand-typed copy. If it does, check `PRINTER_DOT_WIDTH`/`DEVICE_SCALE_FACTOR` in `screenshot.ts` still matches the printer's actual dot width (from its self-test page).

## Adding a new brand at a station that already prints
1. Create the `Restaurant` record as normal.
2. Nothing else. Its orders join that station's existing queue and print on the
   existing printer, labelled with the brand name.

## Adding a new station later
1. Create the `Restaurant` record(s) — the station row is created with them.
2. Physical printer setup (steps above), including the DHCP reservation.
3. Then pick a delivery path:

   **Agent path** (default, works anywhere):
   1. `npm run print-agent:token -- --station <CODE>`.
   2. Deploy `agent/` to one always-on device there, configure `.env`, run as a service.

   **Direct path** (static public IP + a router we administer):
   1. Forward a port to the printer and source-restrict it to the app server.
   2. Set `directPrinterHost`/`directPrinterPort` on the station.
   3. No token, no agent, no device in the kitchen.

   Full steps in [Direct printing](#direct-printing--when-the-printer-has-a-public-address).

## Ticket content
- Layout lives entirely in `src/components/KotTicket.tsx` — what's printed is a screenshot of this component, not a separate template.
- Shows the customer's **Name** (`order.contactName`) under Train/Seat/Arrives.
- Does **not** show a ready-by time — removed from the ticket (still exists elsewhere in the app, e.g. admin views, `ReadyByCountdown`; only the KOT print doesn't display it).

## Adding a new ticket field / order type later
- No print-pipeline changes needed — the ticket is a screenshot of `KotTicket.tsx`. Edit that component, the printed output updates automatically next print.
- Exception: a genuinely different document (not a KOT variant, e.g. a customer receipt) needs its own new page under `src/app/internal/print/`, same pattern as the existing two.
