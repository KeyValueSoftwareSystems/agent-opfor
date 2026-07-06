# SDK Examples (in-repo)

Runnable examples for `@keyvaluesystems/agent-opfor-sdk` from the monorepo.

## Prereqs

- Node.js 20+
- Install deps once at repo root:

```bash
npm install
```

## Quickstart (mock lane, no real keys)

These examples start an in-process mock target + mock OpenAI-compatible LLM. They pass a fake `apiKey` in code.

```bash
node --import tsx/esm runners/sdk/examples/run-suite.functional.ts
node --import tsx/esm runners/sdk/examples/run-with-progress-and-listeners.ts
node --import tsx/esm runners/sdk/examples/report-json-html.ts
node --import tsx/esm runners/sdk/examples/catalog-list.ts
```

## Real target lane (needs keys)

When pointing at real LLM providers / targets, pass the API keys in the `attackerModel` / `judgeModel` configs (or via the top-level `apiKey` fallback).

- **LiteLLM / OpenAI-compatible**: `LITELLM_BASE_URL` + `LITELLM_API_KEY` (see `run-suite.real.ts`)
- **Anthropic**: `apiKey` in model config
- **OpenAI**: `apiKey` in model config
- **Groq / Google / DeepSeek / Azure**: pass `apiKey` and optionally `baseUrl`

```bash
# Terminal 1 — start the test agent
cd tests/e2e/agents/vanilla-chat
cp .env.example .env   # set PROVIDER=openai, BASE_URL, OPENAI_API_KEY
npm run dev

# Terminal 2 — real SDK run (from repo root)
export LITELLM_BASE_URL=https://llm.keyvalue.systems/v1
export LITELLM_API_KEY=...
node --import tsx/esm runners/sdk/examples/run-suite.real.ts
```

Examples that are templates (require extra setup): MCP targets and autonomous `hunt()`.

## Notes

- Examples are **repo-only** (not shipped in the npm package).
- For `run()`, prefer model auth via `apiKey` values in code.
