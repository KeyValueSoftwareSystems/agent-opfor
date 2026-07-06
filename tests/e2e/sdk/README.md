# SDK end-to-end tests

Root-level e2e suite for [`@keyvaluesystems/agent-opfor-sdk`](../../../runners/sdk). Exercises the published SDK entrypoint against an in-process mock HTTP target and OpenAI-compatible mock LLM — **no Docker, no shell scripts**.

## What this validates

| Scenario   | Assertion                                                           |
| ---------- | ------------------------------------------------------------------- |
| Happy path | `run()` returns `RunResults` with summary, evaluators, findings     |
| Progress   | `onProgress` receives `evaluator_start` and `evaluator_done`        |
| Listeners  | `RunListener` hooks fire; `onRunFinish` receives `RunResults`       |
| Error lane | Mock target returns 500 → `attack_done` with `ERROR`, run completes |

## Prerequisites

Build the monorepo first (e2e imports the compiled SDK package):

```bash
npm run build   # from repo root
```

## Run locally

```bash
# From repo root
npm run test:e2e:sdk

# Or from this directory
npm test
```

**Expected runtime:** ~3–5 seconds on a typical laptop (one evaluator, single turn, mock LLM).

**Expected output:** All tests pass; no real API keys required (tests pass a fake `apiKey` in code).

## CI

The `Tests` job in [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) runs `npm run test:e2e:sdk` after `npm run build`.

## Lanes

| Lane                     | Location                                                         | Docker | When             |
| ------------------------ | ---------------------------------------------------------------- | ------ | ---------------- |
| **Mock (default)**       | This package                                                     | No     | Every PR         |
| **Real target (future)** | Optional env-gated tests against `tests/e2e/agents/vanilla-chat` | Yes    | Nightly / manual |

The default lane stays deterministic and fast. Real-agent e2e can be added later behind env flags without changing this structure.

## Layout

```text
tests/e2e/sdk/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── helpers/mockServer.ts   # reusable mock target + LLM
    └── run.e2e.test.ts         # baseline e2e cases
```
