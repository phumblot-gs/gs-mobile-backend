#!/usr/bin/env bash
# Invoke the Lambda locally (via the Hono dev server) and run a quick curl test.
#
# Usage:
#   ./scripts/invoke-local.sh                # starts the dev server in the foreground
#   ./scripts/invoke-local.sh health         # curl /health against a running server
#   ./scripts/invoke-local.sh auth-start     # follow /auth/start in a browser

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
TARGET="${1:-server}"

case "$TARGET" in
  server)
    pnpm --filter @gs-mobile-backend/lambda-api dev
    ;;
  health)
    curl -sSf "http://localhost:${PORT}/health" | jq .
    ;;
  auth-start)
    open "http://localhost:${PORT}/auth/start" || xdg-open "http://localhost:${PORT}/auth/start"
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    echo "Usage: $0 [server|health|auth-start]" >&2
    exit 1
    ;;
esac
