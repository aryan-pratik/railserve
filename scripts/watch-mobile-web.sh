#!/usr/bin/env bash
#
# Rebuilds the rider app's static web bundle whenever its source changes.
#
# The static export has no watcher of its own — that is the trade for not
# running Metro, which holds file watchers and transform workers resident.
# This polls instead: idle cost is one `find` every two seconds, and memory is
# spent only during the few seconds a rebuild actually takes.
#
# Refresh the browser after a rebuild; there is no hot reload, only a fresh
# bundle waiting to be loaded.
#
#   scripts/watch-mobile-web.sh
#
set -u

cd "$(dirname "$0")/../mobile" || exit 1

# `expo export` deletes and recreates its output directory on every run. If the
# static server were pointed at that directory by name, a poll — or the server
# itself, mid-request — can land in the gap between the delete and the
# recreate and see (or keep serving) an empty folder. Building into a fresh,
# timestamped directory each time and swapping a symlink onto it avoids the
# gap entirely: `ln -sfn` replaces the symlink without ever unlinking it first
# (BSD/macOS mv has no -T, so this is the portable way to do it), and a static
# server resolves a symlink at request time, not once at startup, so it is
# never mid-swap from the outside.
STAMP=.web-build-stamp
WATCH=(src App.tsx index.ts)
BUILDS_DIR=.dist-builds
LIVE_LINK=dist

mkdir -p "$BUILDS_DIR"
[ -f "$STAMP" ] || touch "$STAMP"
echo "watching ${WATCH[*]} — rebuilding into $LIVE_LINK/ on change (ctrl-c to stop)"

while true; do
  changed=$(find "${WATCH[@]}" -type f -newer "$STAMP" 2>/dev/null | head -1)
  if [ -n "$changed" ]; then
    # Stamp first: an edit saved mid-build should trigger the next pass rather
    # than be swallowed by this one.
    touch "$STAMP"
    echo "$(date '+%H:%M:%S')  change detected — rebuilding…"
    build="$BUILDS_DIR/$(date +%s)"
    if npx expo export --platform web --output-dir "$build" >/tmp/expo-web-build.log 2>&1; then
      ln -sfn "$build" "$LIVE_LINK"
      # Keep the previous build too, in case a request is mid-flight against
      # it when the symlink swaps; drop anything older.
      ls -1t "$BUILDS_DIR" | tail -n +3 | while read -r old; do rm -rf "${BUILDS_DIR:?}/$old"; done
      echo "$(date '+%H:%M:%S')  rebuilt — refresh the browser"
    else
      echo "$(date '+%H:%M:%S')  BUILD FAILED — see /tmp/expo-web-build.log"
      tail -5 /tmp/expo-web-build.log
    fi
  fi
  sleep 2
done
