#!/bin/bash
#
# RailServe print agent: one-line install for a kitchen Mac.
#
# Paste into Terminal on the Mac that already prints to the kitchen printer:
#
#   curl -fsSL https://raw.githubusercontent.com/aryan-pratik/railserve/main/agent/install-mac.sh | bash -s -- "<AGENT_TOKEN>"
#
# A second argument names the printer when the Mac has several:
#
#   ... | bash -s -- "<AGENT_TOKEN>" "POS80"
#
# and `... | bash -s -- --uninstall` removes everything again.
#
# Needs no admin password. It puts its own copy of Node and the agent in
# ~/railserve-print-agent, prints two test tickets, and registers the agent to
# start at login. See agent/README.md.

set -euo pipefail

# lpstat's wording is what gets parsed below, so pin it to English.
export LC_ALL=C

SERVER_URL="${SERVER_URL:-https://bitestation.elvo.in}"
AGENT_SOURCE="${AGENT_SOURCE:-https://raw.githubusercontent.com/aryan-pratik/railserve/main/agent}"
AGENT_DIR="${AGENT_DIR:-$HOME/railserve-print-agent}"
NODE_DIST="https://nodejs.org/dist/latest-v22.x"
LABEL="in.elvo.railserve-print-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$AGENT_DIR"
  say "Print agent removed."
}

pick_queue() {
  local queues recent count
  queues="$(lpstat -p 2>/dev/null | awk '/^printer /{print $2}')"
  [ -n "$queues" ] || die "This Mac has no printer installed. Add the kitchen printer in System Settings > Printers first."

  # The printer somebody printed to last is the kitchen printer: it is the
  # one the KOTs have been going to from the browser.
  recent="$(lpstat -W completed -o 2>/dev/null | head -1 | awk '{print $1}' | sed -E 's/-[0-9]+$//')"
  if [ -n "$recent" ] && printf '%s\n' "$queues" | grep -qx "$recent"; then
    printf '%s' "$recent"
    return
  fi

  count="$(printf '%s\n' "$queues" | wc -l | tr -d ' ')"
  if [ "$count" = "1" ]; then
    printf '%s' "$queues"
    return
  fi

  printf '\nThis Mac has several printers:\n%s\n' "$queues" >&2
  die "Run the same line again with the kitchen printer's name added at the end, in quotes."
}

install_node() {
  if [ -x "$AGENT_DIR/node/bin/node" ] && "$AGENT_DIR/node/bin/node" -v >/dev/null 2>&1; then
    return
  fi
  local arch file sum
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) die "Unsupported Mac type: $(uname -m)" ;;
  esac

  say "Downloading Node (about 45 MB)"
  curl -fsSL "$NODE_DIST/SHASUMS256.txt" -o "$AGENT_DIR/node-sums.txt" || die "Could not reach nodejs.org. Is this Mac online?"
  file="$(awk -v a="darwin-$arch.tar.gz" 'index($2, a) {print $2}' "$AGENT_DIR/node-sums.txt" | head -1)"
  sum="$(awk -v f="$file" '$2 == f {print $1}' "$AGENT_DIR/node-sums.txt")"
  [ -n "$file" ] && [ -n "$sum" ] || die "Could not find a Node download for this Mac."

  curl -fSL --progress-bar "$NODE_DIST/$file" -o "$AGENT_DIR/node.tar.gz" || die "Node download failed."
  [ "$(shasum -a 256 "$AGENT_DIR/node.tar.gz" | awk '{print $1}')" = "$sum" ] || die "Node download was corrupted. Run the line again."

  rm -rf "$AGENT_DIR/node"
  mkdir -p "$AGENT_DIR/node"
  tar -xzf "$AGENT_DIR/node.tar.gz" -C "$AGENT_DIR/node" --strip-components 1
  rm -f "$AGENT_DIR/node.tar.gz" "$AGENT_DIR/node-sums.txt"
}

main() {
  [ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS."

  if [ "${1:-}" = "--uninstall" ]; then
    uninstall
    return
  fi

  local token="${1:-}" queue="${2:-}"
  [ -n "$token" ] || die "The station's agent token is missing. Paste the whole line you were sent, including the part in quotes."

  if [ -n "$queue" ]; then
    lpstat -p "$queue" >/dev/null 2>&1 || die "No printer called \"$queue\" on this Mac. Installed printers: $(lpstat -p 2>/dev/null | awk '/^printer /{print $2}' | tr '\n' ' ')"
  else
    queue="$(pick_queue)"
  fi
  say "Kitchen printer: $queue"

  # Stop a previous install before replacing its files.
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  mkdir -p "$AGENT_DIR"
  cd "$AGENT_DIR"

  install_node
  export PATH="$AGENT_DIR/node/bin:$PATH"

  say "Installing the print agent"
  for f in print-agent.mjs package.json package-lock.json; do
    curl -fsSL "$AGENT_SOURCE/$f" -o "$AGENT_DIR/$f" || die "Could not download $f."
  done
  npm ci --omit=dev --no-audit --no-fund </dev/null >"$AGENT_DIR/npm.log" 2>&1 || die "npm install failed. See $AGENT_DIR/npm.log"

  (
    umask 077
    cat >"$AGENT_DIR/.env" <<EOF
SERVER_URL="$SERVER_URL"
AGENT_TOKEN="$token"
PRINTER_QUEUE="$queue"
EOF
  )

  say "Printing two test tickets"
  node print-agent.mjs --test </dev/null || die "The test print did not go through. Check the printer is on and has paper, then run the line again."

  # The script itself arrives on stdin, so the answer has to come from the terminal.
  if (exec </dev/tty) 2>/dev/null; then
    printf '\nDid TWO SEPARATE pieces of paper come out? Type y or n, then Enter: '
    local answer=""
    read -r answer </dev/tty || true
    case "$answer" in
      y | Y | yes | YES) ;;
      *) die "Not installed. Tell the admin what came out of the printer (a photo helps)." ;;
    esac
  fi

  say "Starting the agent (it will start by itself after every login)"
  mkdir -p "$HOME/Library/LaunchAgents"
  : >"$AGENT_DIR/agent.log"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-is</string>
    <string>$AGENT_DIR/node/bin/node</string>
    <string>$AGENT_DIR/print-agent.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$AGENT_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$AGENT_DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$AGENT_DIR/agent.log</string>
</dict>
</plist>
EOF
  launchctl bootstrap "$DOMAIN" "$PLIST" || die "Could not register the agent with macOS."

  # Only the background copy counts: it is the one that will be running tomorrow.
  local waited=0
  until grep -q 'connected to server' "$AGENT_DIR/agent.log" 2>/dev/null; do
    if grep -q 'HTTP 401' "$AGENT_DIR/agent.log" 2>/dev/null; then
      launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
      rm -f "$PLIST"
      die "The server rejected the token. Ask the admin for the correct line."
    fi
    waited=$((waited + 1))
    if [ "$waited" -ge 30 ]; then
      tail -5 "$AGENT_DIR/agent.log" >&2 || true
      die "The agent started but could not reach $SERVER_URL. Is this Mac online?"
    fi
    sleep 1
  done

  printf '\nDONE. The print agent is running.\n'
  printf '  - KOTs now print by themselves, each one cut, when you press Generate KOT or Print in the app.\n'
  printf '  - Do not use Cmd+P for KOTs any more: it prints a second copy as one long strip.\n'
  printf '  - Keep this Mac switched on, logged in and awake while the kitchen is working.\n'
}

main "$@"
