# vanilla-chat

Minimal single-turn chat agent. Used for local developer testing of Opfor evaluators (prompt-injection, jailbreak, harmful-content, etc.) where no tools or database are required.

- Port: `4000`
- Endpoints: `POST /chat` (body: `{ "prompt": "..." }`), `GET /health`
- Providers: `openai` | `anthropic` | `groq` | `google` (one key required)

## Run

```bash
cp .env.example .env        # add one provider API key
./scripts/start.sh          # builds + starts via docker compose, waits for /health
./scripts/stop.sh           # docker compose down
```

`start.sh` exits when `http://localhost:4000/health` returns 200.

## Configure

Edit `.env`:

```
PROVIDER=openai             # openai | anthropic | groq | google
OPENAI_API_KEY=...          # supply the key matching PROVIDER
# MODEL=                    # optional override; defaults are per-provider
# BASE_URL=                 # optional, OpenAI-compatible endpoint (Ollama, OpenRouter, Azure)
```

Defaults: openai=`gpt-4o-mini`, anthropic=`claude-3-5-haiku-20241022`, groq=`llama-3.3-70b-versatile`, google=`gemini-2.0-flash`.

## Smoke test

```bash
curl -s http://localhost:4000/health
curl -s -X POST http://localhost:4000/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"hello"}'
```

## Logs

```bash
docker compose logs -f vanilla-chat
```

## Run without Docker

```bash
npm install
npm run dev                 # tsx src/index.ts
```

Reads the same env vars from the shell.
