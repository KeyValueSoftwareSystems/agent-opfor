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

- **Anthropic**: `ANTHROPIC_API_KEY`
- **OpenAI**: `OPENAI_API_KEY`
- **Google**: `GOOGLE_GENERATIVE_AI_API_KEY`
- **Groq**: `GROQ_API_KEY`
- **DeepSeek**: `DEEPSEEK_API_KEY`
- **Azure**: `AZURE_OPENAI_API_KEY` (and `baseUrl` in model config)
- **OpenAI-compatible**: pass `apiKey` and optionally `baseUrl`

Examples that are templates (require extra setup): MCP targets and autonomous `hunt()`.

## Notes

- Examples are **repo-only** (not shipped in the npm package).
- For `run()`, prefer model auth via `apiKey` values in code.
