# Review fixes — critical & high priority

This documents the changes made in response to the senior review (`docs/Review.md`),
covering all **critical** and **high-priority** items (plus two trivial cleanups that
fell out along the way). Every change is type-checked; the testable ones have automated
coverage. See the **Test plan** at the bottom.

---

## 1. (Critical) Judge hardening — OWNED BY TEAMMATE, NOT IN THIS COMMIT

**Files:** `core/src/evaluators/judge.ts`, `core/src/prompts/judge-agent.ts`
(plus the coupled test stubs: `JUDGE_RESPONSE` in `core/tests/runAll.smoke.test.ts` and
`core/tests/orchestrator.equivalence.test.ts`).

This item — structured-output judge (`generateObject` + `JudgeVerdictSchema`), the
`ERROR`-not-silent-`FAIL` parse-failure policy, and the `<attacker_turn>`/`<target_response>`
untrusted-data framing — is **being implemented separately by a teammate** and is excluded
from this commit. Both judge source files are at their pre-review baseline here; the
teammate's PR will change both, and will also flip both `JUDGE_RESPONSE` test stubs from the
current text format to the structured JSON the new judge expects.

The MCP-side judge (`core/src/run/judge.ts`) is touched in this commit only by the item-2
type rename (`ModelConfig` → `LlmConfig`), not by any hardening.

## 2. (High) One LLM-config type — `LlmConfig` is the single source of truth

**Files:** `core/src/config/schema.ts`, `core/src/config/types.ts`,
`core/src/providers/factory.ts`, `core/src/execute/runAll.ts`,
`core/src/llm/openaiCompatible.ts`, `core/src/run/judge.ts`

- `ModelConfigSchema` → renamed to **`LlmConfigSchema`** and made the canonical zod schema.
  `export type LlmConfig = z.infer<typeof LlmConfigSchema>`.
- The hand-written `LlmConfig` interface in `config/types.ts` is gone; it now re-exports the
  zod-inferred type, so all `import { LlmConfig } from ".../config/types.js"` keep working.
- **`resolveModelConfig()` (the field-for-field bridge in runAll.ts) is deleted** — both sides
  are now the same type.
- **Deliberate decision on `apiKeyEnv`:** kept **optional** (the looser of the two prior
  definitions). The MCP/openai-compatible path resolves keys lazily with a fallback, so
  requiring it would have rejected configs that work today. Presence is enforced at use time:
  `createModel` now throws an actionable error when a key is genuinely needed.

## 3. (High) Agent `--config` is now schema-validated

**Files:** `core/src/config/schema.ts` (new `RunConfigSchema` + `parseRunConfig`),
`runners/cli/src/commands/run.ts`

- `opfor run --config <file>` previously did `JSON.parse(raw) as RunConfig` with **no runtime
  check** (unlike the MCP path). It now calls `parseRunConfig()`, which validates target
  (discriminated on `kind`), selection, and `attackerLlm`/`judgeLlm`, and prints an
  actionable, path-prefixed error on failure.
- The schema is intentionally lenient (`.passthrough()`, optional `effort`/`turns`) so legacy
  and downstream-normalized fields aren't rejected — it catches genuine structural mistakes,
  not every field of the 450-line `config/types.ts`.

## 4. (High) `AttackSpec` / `AttackResult` are discriminated unions

**Files:** `core/src/execute/types.ts`, `core/src/generate/generateAttacks.ts`,
`core/src/execute/runAgentLoop.ts`, `core/src/execute/runAll.ts`,
`core/src/report/buildReport.ts`, `runners/sdk/src/run.ts`,
`core/src/execute/runAllBrowser.ts`

- `AttackSpec = AgentAttackSpec | McpAttackSpec` and
  `AttackResult = AgentAttackResult | McpAttackResult`, each keyed on a `kind` discriminant
  (mirroring the existing `TurnRecord` union). Agent-only fields (`prompt`, operator/DOM
  signals) live on the agent arm; MCP-only fields (`toolName`, `toolArguments`,
  `toolResponse`, `toolError`) on the MCP arm.
- Consumers now narrow on `attack.kind` / `result.kind`; the impossible "both `prompt` and
  `toolName`" state is unrepresentable, and the scattered `?? ""` defensive reads are
  compiler-guaranteed.
- `runAgentAttack` takes `AgentAttackSpec`; `runMcpAttack` takes `McpAttackSpec`; runAll
  branches on `attack.kind` (not the config-derived `isMcp`) so the compiler narrows.
- **Runtime/serialization note:** each attack object in the report JSON now carries a
  `kind` field. This is additive — all previously present fields remain on their respective
  arm — so existing report consumers and the extension popup are backward compatible.

## 5. (High) Orchestrator drift guard — shared aggregation + equivalence test

**Files:** `core/src/execute/aggregate.ts` (new), `core/src/execute/runAll.ts`,
`core/src/execute/runAllBrowser.ts`, `core/tests/orchestrator.equivalence.test.ts` (new)

- The copy-pasted verdict tally (`passed`/`failed`/`errors`) and report summary
  (`safetyScore`/`attackSuccessRate`) — which appeared in **5 places** — now live once in
  `aggregate.ts` (`summarizeVerdicts`, `toEvaluatorResult`, `buildUnifiedReport`,
  `modelLabel`). Both `runAll` and `runAllBrowser` (loops + report builders) call them, so a
  tally fix or a new report field happens in one place and both paths get it. (This also
  resolves the medium-priority "report aggregation copy-pasted five times" item.)
- **Equivalence test added** (the review's explicit ask): one input is run through both
  `runAll` and `runAllBrowser` against a stub server, asserting the report summaries and
  per-evaluator tallies match.
- **Deliberately deferred:** fully merging the per-evaluator _loop bodies_ (expressing
  `runAllBrowser` as a thin config of `runAll`). The Node loop is a genuine superset — disk
  loading, MCP, telemetry curation, and `depends_on` session capture sit inside it — so a
  full merge is a larger, riskier change. Sharing the tally/report math removes the concrete
  drift the review flagged ("someone who fixes a tally bug…"); the equivalence test guards the
  rest. This is a good standalone follow-up PR.

## 6. (High, scope-corrected) DO-NOT-DEPLOY warnings on vulnerable fixtures

**Files:** `tests/e2e/agents/customer-support/src/index.ts`,
`tests/e2e/agents/vulnerable-memory/src/index.ts`, `SECURITY.md`

- Added a loud top-of-file `DO NOT DEPLOY` banner to `customer-support` (had none) and to
  `vulnerable-memory`'s source (its README already had one; the source did not).
- Added an **"Intentionally vulnerable fixtures"** section to `SECURITY.md` naming all three
  fixtures as insecure-by-design and out of scope for vulnerability reports.

> Validation correction: the review listed `vulnerable-memory` as lacking any warning — its
> README already had one. The real gap was `customer-support` + `SECURITY.md`.

## 7. (High, scope-corrected) Evaluator schema — single source of truth in CONTRIBUTING

**File:** `CONTRIBUTING.md`

- Added an explicit callout making `docs/evaluator-schema.md` (and the Zod
  `EvaluatorFrontmatterSchema`) authoritative, and noting the schema is `.strict()` (unknown
  keys fail loudly).

> Validation correction: the review's premise that the schema is `.passthrough()` and silently
> swallows wrong keys was **false** — it's already `.strict()`, and the `*-source.md`
> source-analysis files load fine via a dedicated schema. So this is a pure-docs fix, not a
> code change.

## Bonus (Low) — stale `generateAttacks` docstring

**File:** `core/src/generate/generateAttacks.ts` — updated the docstring from the obsolete
`medium`/`hard` effort wording to the actual `adaptive`/`comprehensive`.

---

## Behavior / migration notes

- **Judge output:** unchanged in this commit (the structured-output judge is the teammate's
  separate PR — see §1). The migration notes for it land with that PR.
- **`apiKeyEnv`:** optional on the unified `LlmConfig`. Missing-key errors now surface from
  `createModel`/`validateLlmConfig` with a clear message instead of being a type-level
  guarantee.
- **`opfor run --config`:** a malformed config now fails fast with a validation error instead
  of producing confusing downstream failures.
- **Report JSON:** each attack now includes a `kind: "agent" | "mcp"` field (additive).

---

## Test plan

### Automated (run now)

```bash
npm run typecheck                 # tsc -b across core + all runners — currently 0 errors
npm run lint                      # eslint — clean
npm test --workspace=core         # node --test; 36 pass, 2 skipped (live-LLM), 0 fail
npm run build:core --workspace=@agent-opfor/extension   # browser bundle builds
```

New/updated automated coverage:

- `core/tests/orchestrator.equivalence.test.ts` — **new.** Unit asserts for the shared
  aggregate helpers + an integration test running one input through `runAll` and
  `runAllBrowser` and asserting matching reports (the review's requested drift guard). Its
  judge stub is plain text, matching the current (un-hardened) judge; the teammate's judge PR
  flips it to JSON.

> Judge correctness, the parse-failure (`ERROR`) path, and the prompt-injection-framing checks
> belong to the teammate's judge PR (§1) and are not part of this commit's test plan.

### Manual / live (need an API key or services)

1. **Config validation** — run `opfor run --config <file>` with (a) a valid config, (b) a
   config missing `target`, (c) a config with a bad `target.kind`. Expect a clear validation
   error for (b)/(c) and normal operation for (a).
2. **End-to-end agent run** — against `tests/e2e/agents/customer-support` (and/or
   `vulnerable-chat`), confirm reports render and verdict counts look right.
3. **MCP run** — against `tests/e2e/mcp/vulnerable-server`, confirm the MCP path (which uses
   the discriminated `McpAttackSpec`/`McpAttackResult` and the unified `LlmConfig` for the
   judge model) still produces a report.
4. **Browser extension** — load the unpacked extension, run against a chat UI, and confirm the
   popup renders results (the report JSON now includes the additive `kind` field).

### Suggested follow-ups (not done here)

- Merge the `runAll`/`runAllBrowser` per-evaluator loop bodies behind one injected runner
  (the equivalence test will guard the refactor).
- Apply the same structured-output hardening to the MCP judge (`core/src/run/judge.ts`).
- Keep `judge-rubric.md` in sync with `judge-agent.ts`, or delete it if it's unused.
