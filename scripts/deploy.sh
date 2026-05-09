#!/usr/bin/env bash
# Rebuild the inventar_web container with the current working tree and
# swap it in. Run from anywhere; the script cd's to the repo root itself.
#
# Usage:
#   ./scripts/deploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building inventar_web image…"
docker compose build inventar_web

echo "==> Recreating container…"
docker compose up -d --force-recreate

echo "==> Waiting for health check…"
for i in {1..20}; do
  status="$(docker inspect --format='{{.State.Health.Status}}' inventar_web 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then
    echo "==> healthy"
    exit 0
  fi
  if [ "$status" = "unhealthy" ]; then
    echo "==> UNHEALTHY — recent logs:"
    docker logs --tail 30 inventar_web
    exit 1
  fi
  sleep 3
done

echo "==> Health check did not report healthy within 60s; current status: $status"
docker logs --tail 30 inventar_web
exit 1
