# Refactor Handoff — `refactor/core-as-package`

**Branch:** `refactor/core-as-package`
**Date:** 2026-05-21
**Status:** Phase B shipped. Phase C deferred (documented below).

---

## Goal of the refactor

Move the shared engine into `core/` and reduce all runners (`runners/cli`, `runners/mcp`, `runners/extension`) to thin shells over it. One source of truth for attacker prompts, judge prompts, and provider wiring.

Agent-redteaming and MCP-redteaming intentionally keep separate prompt domains — see header comments in `core/src/evaluators/judge.ts` vs `core/src/run/judge.ts`. Each domain still has exactly one canonical prompt that all runners use.

---

## What landed today (3 commits on top of `2e7fc02`)

| Commit    | Title                                                                     | What changed                                                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f6cc105` | `test(core): add runAll smoke test for post-loop judge invariant`         | 5 tests over `runAll` using a local node:http server (target + LLM). Catches the per-turn-judge regression. Inlines the agent judge prompt into `core/src/prompts/judge-agent.ts` so `evaluators/judge.ts` is browser-safe. Adds "do not merge agent vs MCP" header comments to both judge files.       |
| `96f8b2a` | `refactor(extension): replace internal LLM stack with @opfor/core engine` | Extension now drives attack generation + judging through core. esbuild bundles `core/src/browser.ts` to `runners/extension/dist/core.bundle.js`. Adds `domTarget.js` (core `AgentTarget` adapter) and `llmUiActions.js` (DOM-only LLM helpers). Deletes `llmPlanner.js` + the two `prompts/*.md` files. |
| `cfef1cb` | `chore: remove orphaned extension files and update doc references`        | Deletes orphaned `prompts.js` and the now-empty `prompts/` directory. Updates `AGENT.md` and `runners/extension/README.md` inventory tables.                                                                                                                                                            |

`nova.json`, `netra-mcp.json`, and `terminal-debug-logs-test-run.txt` were intentionally left untracked.

---

## Where things live now

**Engine (`core/`):**

- `core/src/prompts/attacker-adaptive.ts` — the only attacker prompt for agent-redteaming
- `core/src/prompts/judge-agent.ts` — the only agent-redteaming judge prompt
- `core/src/evaluators/judge.ts` — `judgeResponse()` (agent flow)
- `core/src/run/judge.ts` — `judgeToolResponse()` (MCP flow; different prompt by design)
- `core/src/generate/generateNextTurn.ts` — `generateNextAdaptiveTurn()` for adaptive multi-turn
- `core/src/providers/factory.ts` — `createModel()`, `PROVIDER_ENV_VARS`, `PROVIDER_DEFAULTS`
- `core/src/lib/env.ts` — `setEnvProvider()` for non-Node environments
- `core/src/browser.ts` — browser-safe export surface used by the extension bundle
- `core/tests/runAll.smoke.test.ts` — runs against the real `agent-goal-hijack` evaluator

**Runners:**

- `runners/cli/` — already thin, imports from `@opfor/core` (no changes today)
- `runners/mcp/` — already thin, imports from `@opfor/core` (no changes today)
- `runners/extension/`
  - `orchestrator.js` / `service_worker.js` — call `generateNextAdaptiveTurn` and `judgeResponse` from the bundled core, with small adapters (`buildModelFromProfile`, `adaptJudgeResult`) to bridge the extension's profile / judgment shape
  - `llmUiActions.js` — DOM-specific helpers (`aiPickInputInFrame`, `aiUiNextAction`, `llmShortenMessage`) — still uses `callLlm` from `llm.js` because these need provider-native JSON mode
  - `domTarget.js` — `AgentTarget`-compatible adapter (pause polling, OPFOR_STOP, message-too-long retry). Ready for Phase C.
  - `dist/core.bundle.js` — gitignored; rebuilt by `npm run build`

---

## How to verify

```bash
PATH=~/.nvm/versions/node/v24.0.2/bin:$PATH npm run typecheck   # passes
PATH=~/.nvm/versions/node/v24.0.2/bin:$PATH npm test             # 5/5 pass
PATH=~/.nvm/versions/node/v24.0.2/bin:$PATH npm run build        # produces dist/core.bundle.js, no Node-only leakage
```

Manual sanity check: load `runners/extension/` unpacked in Chrome (after `npm run build`) and run one evaluator against a known agent. Confirm in the popup that judgment renders correctly (we map core's `reasoning → summary` and `evidence → findings[0].text` so the existing popup HTML is unchanged).

---

## What's left (Phase C — safe to defer)

Both tracks are independent. Neither blocks shipping the current branch.

### Track F — `runAll` accepts pre-loaded evaluators

Today the extension still runs its own ~600-line loop in `orchestrator.js`. Once `runAll` can accept already-parsed evaluators, the extension can drop the loop and call `runAll` directly.

**Work:**

1. Extend `EvaluatorSelection` in `core/src/execute/types.ts` with `{ mode: "preloaded"; evaluators: EvaluatorSpec[] }`.
2. In `core/src/execute/runAll.ts`, branch in `resolveEvaluatorIds`: if `selection.mode === "preloaded"`, return them directly instead of going through `loadBuiltinEvaluator` (which hits `node:fs`).
3. In the extension, load evaluators from `catalog.json` and pass them via `selection: { mode: "preloaded", evaluators }`. Use `domTarget.js` as the `target`. Delete the loop body in `orchestrator.js`.

**Watch out for:** the extension's pause/resume/stop logic currently lives inside the loop and persists state to `chrome.storage.local`. `runAll` doesn't know about chrome storage — you'll either need to thread a callback through `RunAllOptions.onProgress` or extend `DomTarget` to manage pause/stop signalling.

### Track G — Consolidate `extension/llm.js` + `providers.js` into core

The extension still has its own provider router (`callOpenAiCompat`, `callAnthropic`, `callGoogle`) because the DOM helpers need provider-native JSON mode and `generateText` returns text. Once core exposes a structured-output helper, `llmUiActions.js` can use it and the extension can delete `llm.js` + `providers.js`.

**Work:**

1. Add `core/src/lib/generateJsonObject.ts` that wraps Vercel AI SDK's `generateObject` (or `generateText` with `providerOptions: { openai: { response_format: { type: 'json_object' } } }`).
2. Handle providers without native JSON mode (Anthropic, Google) — either via prompt-engineering fallback or by routing through `generateObject` with a Zod schema.
3. Update `runners/extension/llmUiActions.js` to call the new core helper. Delete `llm.js` and `providers.js`. Update `config.js` (uses `PROVIDERS` from `providers.js`) to import from core instead.

**Why this isn't urgent:** the bridge is invisible to users today. Attacker + judge prompts are already shared (the actual goal). This track is mostly code reduction.

---

## Other small follow-ups (1-hour items)

- `runners/extension/llm.js` still routes via raw `fetch` — fine for now, but once Track G lands, this whole file goes away.
- No unit tests in `runners/cli`, `runners/mcp`, or `runners/extension`. If we add any, the `core/tests/runAll.smoke.test.ts` setup with a local HTTP server is a good template.
- `core/src/browser.ts` deliberately does **not** export `runAll` because `runAll` calls `loadBuiltinEvaluator` which uses `node:fs`. Track F unblocks this.

---

## Quick orientation if you've never touched this branch

1. Read `AGENT.md` (top-level) for project layout and conventions.
2. Read `core/src/prompts/attacker-adaptive.ts` and `core/src/prompts/judge-agent.ts` — these are the prompts every runner uses.
3. Read `core/src/execute/runAll.ts` if you're touching Track F.
4. Read `runners/extension/orchestrator.js` if you're touching Track F or anything extension-side.
5. The smoke test (`core/tests/runAll.smoke.test.ts`) is the cheapest way to verify behaviour without spinning up a real target.

Rollback if needed: `git revert <sha>` on any of the three commits — they're independent. Phase B as a whole reverts to `2e7fc02`.
