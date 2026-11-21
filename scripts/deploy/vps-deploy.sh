#!/usr/bin/env bash
# Runs ON the VPS, called by .github/workflows/deploy-prod.yml with the image
# to deploy (already pulled). Backs up Mongo, swaps the app container, checks
# that /login answers, and rolls back to the previous image if it doesn't.
#
# The chosen image is written to /root/railserve/.env as RAILSERVE_IMAGE,
# which docker compose reads for interpolation, so a later manual
# `docker compose up -d` keeps the deployed image instead of an old one.
set -euo pipefail
NEW="$1"
cd /root/railserve
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "== backup"
# Its own file name, separate from the nightly railserve-*.gz, and only the two
# newest are kept: each dump is about 1 GB and the disk is shared.
BK=/root/railserve-backups
TS="$(date -u +%Y%m%dT%H%M%SZ)"
docker exec railserve-mongo mongodump --uri="mongodb://localhost:27017" \
  --db=railserve --archive=/tmp/predeploy.gz --gzip >/dev/null 2>&1
docker cp railserve-mongo:/tmp/predeploy.gz "$BK/predeploy-$TS.gz" >/dev/null
docker exec railserve-mongo rm -f /tmp/predeploy.gz
ls -1t "$BK"/predeploy-*.gz | tail -n +3 | xargs -r rm -f
echo "   $(stat -c%s "$BK/predeploy-$TS.gz") bytes -> predeploy-$TS.gz"

PREV="$(docker inspect railserve-app --format '{{.Config.Image}}' 2>/dev/null || true)"
echo "== previous image: ${PREV:-none}"

swap() {
  printf 'RAILSERVE_IMAGE=%s\n' "$1" > .env
  $COMPOSE up -d --no-build app
}

healthy() {
  for _ in $(seq 1 45); do
    code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || true)"
    [ "$code" = "200" ] && return 0
    sleep 2
  done
  return 1
}

echo "== deploying $NEW"
swap "$NEW"
if healthy; then
  echo "== healthy on $NEW"
  # Keep the three newest deployed images for quick rollback, drop the rest.
  docker images "${NEW%:*}" --format '{{.Repository}}:{{.Tag}}' | tail -n +4 | xargs -r docker rmi >/dev/null 2>&1 || true
  exit 0
fi

echo "!! /login did not answer 200 on $NEW"
docker logs --tail 50 railserve-app || true
if [ -n "$PREV" ]; then
  echo "== rolling back to $PREV"
  swap "$PREV"
  healthy && echo "== rolled back" || echo "!! rollback also unhealthy"
fi
exit 1
