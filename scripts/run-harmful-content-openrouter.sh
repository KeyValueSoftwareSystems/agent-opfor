#!/usr/bin/env bash
# Run the harmful-content suite against an OpenRouter chat model.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONFIG="${OPFOR_CONFIG:-$ROOT/examples/harmful-content-openrouter.config.json}"
ENV_FILE="${OPFOR_ENV:-$ROOT/.env}"

if [[ ! -f "$CONFIG" ]]; then
  echo "Config not found: $CONFIG" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy and fill in your key:" >&2
  echo "  cp examples/harmful-content.env.example .env" >&2
  exit 1
fi

if ! command -v opfor >/dev/null 2>&1; then
  echo "opfor not on PATH — building CLI from source…" >&2
  npm run install:cli
fi

exec opfor execute --config "$CONFIG" --env "$ENV_FILE" "$@"
