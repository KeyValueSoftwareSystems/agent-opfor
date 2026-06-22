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

echo "=> Starting vanilla-chat agent..."
docker compose up -d --build

echo "=> Waiting for agent to be healthy (up to 30s)..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4000/health > /dev/null 2>&1; then
    echo ""
    echo "=> Agent is ready at http://localhost:4000"
    echo ""
    echo "Next steps (from repo root):"
    echo "  opfor run --config tests/e2e/agents/vanilla-chat/opfor.config.json"
    echo ""
    echo "Logs:  docker compose logs -f vanilla-chat"
    echo "Stop:  ./scripts/stop.sh"
    exit 0
  fi
  printf "."
  sleep 1
done

echo ""
echo "Error: agent did not become healthy after 30s"
echo "Check logs: docker compose logs vanilla-chat"
exit 1
