#!/bin/bash
set -euo pipefail

# Simple local static server for VenomMaps2 (bypasses embedded shells)
# Usage: double‑click this file in Finder, or run without arguments.

PORT=${1:-8123}
DIR="$(cd "$(dirname "$0")" && pwd)"

# Free port if already in use
PID=$(lsof -ti tcp:${PORT} 2>/dev/null || true)
if [ -n "${PID:-}" ]; then
  kill -9 $PID || true
fi

cd "$DIR"
echo "Serving $DIR at http://localhost:${PORT}"
exec python3 -m http.server "$PORT"


