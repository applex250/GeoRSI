#!/usr/bin/env bash
# GeoRSI Lab - One-click update (Linux / macOS / Windows Git Bash)
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh              # incremental rebuild + restart
#   ./deploy.sh --clean      # full rebuild no cache
#   ./deploy.sh --logs       # follow logs after build
#   ./deploy.sh --selftest   # run selftest after build
#   ./deploy.sh --smoke      # run smoke episode after build (needs API key)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

CLEAN=0
LOGS=0
SELFTEST=0
SMOKE=0

for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --logs) LOGS=1 ;;
    --selftest) SELFTEST=1 ;;
    --smoke) SMOKE=1 ;;
    --help|-h)
      echo "Usage: ./deploy.sh [--clean] [--logs] [--selftest] [--smoke]"
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# 1) Prerequisites
if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] ERROR: docker not found. Install Docker Desktop / Engine" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "[deploy] ERROR: docker compose not found" >&2
  exit 1
fi

echo "[deploy] using: $($COMPOSE version 2>&1 | head -n1)"
echo "[deploy] workdir: $ROOT"

# 2) Ensure runtime dirs and .env
mkdir -p runs knowledge rag
if [[ ! -f .env && -f .env.example ]]; then
  echo "[deploy] WARN: .env not found, copied from .env.example - fill API keys"
  cp .env.example .env
fi
mkdir -p ../rsi-lab-private 2>/dev/null || true

# 3) Pull base image (best-effort)
echo "[deploy] pulling base image updates (best-effort)..."
docker pull node:22-bookworm-slim || true

# 4) Build
echo "[deploy] building image georsi:latest ..."
if [[ $CLEAN -eq 1 ]]; then
  $COMPOSE build --no-cache --pull
else
  $COMPOSE build --pull
fi

# 5) Recreate
echo "[deploy] recreating containers ..."
$COMPOSE down --remove-orphans || true

# 6) Up
echo "[deploy] starting georsi ..."
$COMPOSE up -d

# 7) Status
echo "[deploy] waiting for container ..."
sleep 3
$COMPOSE ps
echo ""
docker images georsi:latest --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" || true

# 8) Optional verify
if [[ $SELFTEST -eq 1 ]]; then
  echo ""
  echo "[deploy] running selftest inside container ..."
  $COMPOSE run --rm georsi npx tsx src/run.ts selftest
  echo "[deploy] selftest done"
fi

if [[ $SMOKE -eq 1 ]]; then
  echo ""
  echo "[deploy] running smoke (needs API key) ..."
  $COMPOSE run --rm georsi npx tsx src/run.ts smoke || echo "[deploy] smoke finished with non-zero (maybe no API key)"
fi

# 9) Prune
echo "[deploy] pruning dangling images ..."
docker image prune -f >/dev/null 2>&1 || true

echo ""
echo "[deploy] DONE. Useful commands:"
echo "  $COMPOSE logs -f georsi          # logs"
echo "  $COMPOSE exec georsi sh          # shell"
echo "  $COMPOSE run --rm georsi npx tsx src/run.ts selftest"
echo "  $COMPOSE run --rm georsi npx tsx src/run.ts smoke"
echo "  $COMPOSE down                    # stop"

if [[ $LOGS -eq 1 ]]; then
  echo ""
  echo "[deploy] following logs (Ctrl+C to exit)..."
  $COMPOSE logs -f georsi
fi
