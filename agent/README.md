# RailServe print agent

Runs on one always-on device on the **kitchen's own Wi-Fi** — not on the app
server, which cannot reach the printer's private IP from a data-center VM.
See `docs/KOT_PRINTING.md` in the app repo for the full picture.

**Not every station needs this.** Where the outlet has a static public IP and
a router we administer, the printer's port is forwarded and the app server
prints to it directly — no agent, no token, no device in the kitchen. Setting
that up is
[Direct printing](../docs/KOT_PRINTING.md#direct-printing--when-the-printer-has-a-public-address),
not this README.

## What it does

Loops forever: asks the RailServe server "any print job for this station?",
and when there is one, sends it to the kitchen printer, then tells the server
it's done. Every ticket goes out on its own with its own cut — which a print
from the browser (Ctrl/Cmd+P) cannot do: the printer driver cuts once per
print job, so a whole train comes out as one strip.

## A Mac that already prints: one line

If the kitchen has a Mac with the printer installed, paste this into Terminal
on it (the token comes from step 1 below):

```
curl -fsSL https://raw.githubusercontent.com/aryan-pratik/railserve/main/agent/install-mac.sh | bash -s -- "<AGENT_TOKEN>"
```

It needs nothing installed and no admin password. It downloads Node and the
agent into `~/railserve-print-agent`, finds the printer, prints two test
tickets (they must come out as **two separate pieces**), and registers the
agent to start at every login. It prints through the Mac's own print queue
(`PRINTER_QUEUE`), so Wi-Fi or USB both work and no IP is needed. Add the
printer's name as a second quoted argument if the Mac has several; pass
`--uninstall` instead of the token to remove it. Log:
`~/railserve-print-agent/agent.log`.

The rest of this file is the manual setup, for any other device.

## One-time setup per station

1. On the RailServe server (not here), generate a token for the station —
   one station is one kitchen is one printer, however many brands trade there:
   ```
   npm run print-agent:token -- --station <CODE>
   ```
   This prints an `AGENT_TOKEN` — copy it. The script reads `.env.local`, so
   run from a laptop it talks to the **dev** database; production rejects
   that token (the agent logs `HTTP 401`). A production station's token is
   `Station.printAgentToken` in the database on the server.

2. Get the printer's local IP (hold its feed button ~3s to print a self-test
   page, look for `STA IP`). Set a DHCP reservation for it on the outlet's
   router so it never changes.

3. On the bridge device, in this `agent/` folder:
   ```
   npm install
   cp .env.example .env
   ```
   Fill in `.env`:
   - `SERVER_URL` — the production app URL (e.g. `https://bitestation.elvo.in`)
   - `AGENT_TOKEN` — from step 1
   - `PRINTER_HOST` — from step 2. On a computer that already has the printer
     installed, set `PRINTER_QUEUE` to its name (`lpstat -p`) instead and
     skip step 2
   - `PRINTER_PORT` — leave as `9100` unless the printer's self-test page says otherwise

4. Run it:
   ```
   npm start
   ```
   `node print-agent.mjs --test` prints two test tickets without touching the
   server; they must come out as two separate pieces.

   Leave it running — set it up as a system service (systemd, pm2, launchd,
   whatever the bridge device supports) so it survives a reboot.

## Testing without a separate device

For local dev, this can run on the same machine as the app server — open a
second terminal, `cd agent`, point `SERVER_URL` at `http://localhost:3000`,
and `npm start`. Click Print in the app; the agent should pick the job up
within `POLL_INTERVAL_MS`.
