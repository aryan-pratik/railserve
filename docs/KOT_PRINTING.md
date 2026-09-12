# KOT printing — setup & reference

## Why this exists
- Kitchen printer (KPC307-UEWB-AB28) sits on the outlet's local Wi-Fi, private IP.
- App server (Contabo VM) is in a data center — cannot reach a private LAN IP directly.
- Fix: a small **print agent** runs on a device at the outlet, bridges cloud → local printer.

## Architecture
```
Manager clicks "Generate KOT" (or Print)
  → server renders the real KotTicket component via headless Chrome (screenshot, not hand-typed text)
  → image saved as a PrintJob in MongoDB, status "pending"
  → outlet's print agent polls /api/print-agent/poll every few seconds
  → agent claims the job, sends image to printer's local IP:9100 (ESC/POS raster)
  → agent calls /api/print-agent/ack (done/failed)
```
- Server **never** talks to the printer directly. Only the agent does.
- Each outlet needs its own printer + its own agent + its own token.

## One-time printer setup (per printer)
1. Power on, load paper.
2. Connect to printer's own hotspot: Wi-Fi `KPC307-UEWB-AB28`, password `88888888`.
3. Browser → `http://192.168.223.1`.
4. **WiFi tab**: set `STA SSID` / `STA PSK` to the outlet's real Wi-Fi + password → Set.
5. **Network tab**: switch mode to **STA** (client) → Set.
6. Reconnect your device to the outlet's normal Wi-Fi.
7. Hold printer's feed button ~3s → prints self-test page → note `STA IP` (= `PRINTER_HOST`) and MAC.
8. On the outlet's router: set a **DHCP reservation** for that MAC so the IP never changes.

## One-time app setup (per outlet)
```
npm run print-agent:token -- --restaurant <restaurantId>
# --rotate to replace an existing token
```
- Generates/reads `Restaurant.printAgentToken`. Copy the printed `AGENT_TOKEN`.

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
| `src/lib/models/Restaurant.ts` | `printAgentToken` field lives here. |
| `src/lib/printer/screenshot.ts` | Headless-Chrome screenshot of the real ticket → PNG, resized to the printer's `576` dot width. |
| `src/lib/printer/queue.ts` | Enqueue helpers (`enqueueOrderKotPrint`, `enqueueRunKotPrint`). |
| `src/app/internal/print/order/[id]`, `.../run/[runKey]` | Token-gated, session-free render-only pages the screenshot step hits. |
| `src/app/api/print-agent/poll`, `/ack` | What the agent calls. Token-authenticated, no login session. |
| `src/app/api/store/orders/[id]/kot`, `.../runs/[runKey]/kot` | Manual print trigger (the Print button). |
| `src/app/store/actions.ts` | `generateKot` / `generateRunKot` — auto-print hook. |

## Troubleshooting
- **Nothing prints, no error shown**: check the agent is actually running (`ps aux | grep print-agent`) and its `AGENT_TOKEN` matches the order's outlet — a mismatched token means the job just sits `pending` forever, silently.
- **Job stuck `pending`**: query `printjobs` collection, check `restaurantId` matches an outlet whose agent is currently polling.
- **Schema/field changes to `Restaurant` or `PrintJob` not taking effect after a dev-server restart**: Turbopack's `.next` cache can serve a stale compiled model. Fix: `rm -rf .next` then `npm run dev`.
- **`printJobId not found or not claimed by you`** on ack: another agent instance (wrong token, or a duplicate process) already claimed it first — check for duplicate agent processes.
- **Print looks different from the screen**: shouldn't happen — it's a screenshot of the real `KotTicket` component, not a hand-typed copy. If it does, check `PRINTER_DOT_WIDTH`/`DEVICE_SCALE_FACTOR` in `screenshot.ts` still matches the printer's actual dot width (from its self-test page).

## Adding a new outlet later
1. Create the `Restaurant` record as normal — no code changes.
2. Physical printer setup (steps above).
3. `npm run print-agent:token -- --restaurant <id>`.
4. Deploy `agent/` to one always-on device there, configure `.env`, run as a service.
- Nothing else needed. The queue/poll/ack system is already outlet-agnostic.

## Ticket content
- Layout lives entirely in `src/components/KotTicket.tsx` — what's printed is a screenshot of this component, not a separate template.
- Shows the customer's **Name** (`order.contactName`) under Train/Seat/Arrives.
- Does **not** show a ready-by time — removed from the ticket (still exists elsewhere in the app, e.g. admin views, `ReadyByCountdown`; only the KOT print doesn't display it).

## Adding a new ticket field / order type later
- No print-pipeline changes needed — the ticket is a screenshot of `KotTicket.tsx`. Edit that component, the printed output updates automatically next print.
- Exception: a genuinely different document (not a KOT variant, e.g. a customer receipt) needs its own new page under `src/app/internal/print/`, same pattern as the existing two.
