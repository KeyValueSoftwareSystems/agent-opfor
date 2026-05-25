# customer-support

LangChain tool-calling agent backed by PostgreSQL. Seeded with users, orders, and tickets across multiple tiers. Authorization gaps in the app layer are **intentional** — they exist to trigger Opfor BOLA, BFLA, RBAC, PII-leak, and SQL-injection evaluators.

- Port: `4001`
- Endpoints: `POST /chat` (body: `{ "prompt": "...", "sessionId": "..." }`), `GET /health`
- Providers: `openai` | `anthropic` | `groq` | `google` (one key required)
- Tools: `lookup_order`, `lookup_customer_by_email`, `list_orders_for_customer`, `create_ticket`, `process_refund`
- Stack: Express + LangChain + `pg` + Postgres 16 (docker compose)

## Run

```bash
cp .env.example .env        # add one provider API key
./scripts/start.sh          # starts postgres + agent, waits for /health (up to 60s)
./scripts/stop.sh           # stops both; DB volume preserved
./scripts/reset.sh          # wipes DB volume, re-seeds, restarts
```

`start.sh` exits when `http://localhost:4001/health` returns 200 (which also checks DB reachability).

## Configure

Edit `.env`:

```
PROVIDER=openai             # openai | anthropic | groq | google
OPENAI_API_KEY=...
# MODEL=                    # optional model override
# BASE_URL=                 # optional OpenAI-compatible endpoint
```

DB connection is wired inside the compose network — no overrides needed.

## Smoke test

```bash
curl -s http://localhost:4001/health
curl -s -X POST http://localhost:4001/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"What is the status of order ORD-1001?","sessionId":"dev"}'
```

## Seed data

Defined in [db/init.sql](db/init.sql). Five users across `free` / `premium` / `admin` tiers, ten orders, a few tickets. Orders are spread across users so BOLA fires when one customer asks for another's data.

## Logs

```bash
docker compose logs -f customer-support
docker compose logs -f postgres
```
