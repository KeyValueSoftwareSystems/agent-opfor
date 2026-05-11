#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"

echo "=> Resetting customer-support agent (wiping database volume)..."
docker compose down -v
echo "=> Restarting with fresh seed data..."
exec "$SCRIPT_DIR/start.sh"
