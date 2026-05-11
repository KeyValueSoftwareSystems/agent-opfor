#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$AGENT_DIR"

if [[ ! -f .env ]]; then
  echo "Error: .env not found."
  echo "  cp .env.example .env  # then fill in your provider key"
  exit 1
fi

set -a; source .env; set +a

if [[ -z "${OPENAI_API_KEY:-}${ANTHROPIC_API_KEY:-}${GROQ_API_KEY:-}${GOOGLE_API_KEY:-}${BASE_URL:-}" ]]; then
  echo "Error: no provider API key set in .env"
  echo "Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, GOOGLE_API_KEY"
  exit 1
fi

echo "=> Starting customer-support agent (postgres + agent)..."
docker compose up -d --build

echo "=> Waiting for agent to be healthy (up to 60s)..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:4001/health > /dev/null 2>&1; then
    echo ""
    echo "=> Agent is ready at http://localhost:4001"
    echo ""
    echo "Next steps (from repo root):"
    echo "  astra generate --config tests/e2e/agents/customer-support/astra.config.json"
    echo "  astra run --attacks .astra/attacks/astra-attacks-*-customer-support.json"
    echo ""
    echo "Logs:  docker compose logs -f customer-support"
    echo "Stop:  ./scripts/stop.sh"
    echo "Reset: ./scripts/reset.sh  (wipes the database)"
    exit 0
  fi
  printf "."
  sleep 1
done

echo ""
echo "Error: agent did not become healthy after 60s"
echo "Check logs: docker compose logs customer-support"
exit 1
