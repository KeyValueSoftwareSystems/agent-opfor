#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"

echo "=> Stopping customer-support agent..."
docker compose down
echo "=> Done. Database volume is preserved. Run ./scripts/reset.sh to wipe it."
