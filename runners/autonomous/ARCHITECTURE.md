# `@opfor/autonomous` — Architecture & Workflow

An autonomous, **Claude-Agent-SDK-native** adaptive red-team agent. You give it a
target endpoint + key + a free-text objective; it does its own recon, dynamically
picks vectors/personas/strategies, runs adaptive multi-turn attacks, **judges itself**,
decides per-turn whether to continue/escalate/pivot/stop, and produces a report.

It is **fully standalone** — no `@opfor/core` import. The only opfor concept it reuses
is the _idea_ of evaluators, reframed as seed knowledge (rubrics, not attack scripts).

---

## 1. The big picture

```
                    ┌─────────────────────────── opfor-auto (CLI) ───────────────────────────┐
                    │  parse flags → AutoOptions → runAutonomous() → write report             │
                    └─────────────────────────────────┬───────────────────────────────────────┘
                                                       │
                              query({ systemPrompt, agents, mcpServers, hooks })   ← Claude Agent SDK
                                                       │
   ┌───────────────────────────────────────────────── COMMANDER (Opus) ─────────────────────────────────────────┐
   │  recon → plan vectors → DISPATCH subagents → collect → (optional verify) → synthesize → submit_report        │
   └───────┬───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
           │ spawns (Agent tool, parallel)                  │ spawns
   ┌───────▼─────────┐                            ┌─────────▼──────────────────────────────────┐
   │  RECON subagent │                            │  ATTACKER subagent  × N (one per vector)    │
   │  (Haiku)        │                            │  (Sonnet) — adaptive multi-turn loop        │
   │  benign probes  │                            │  send → self-judge → decide → record        │
   └───────┬─────────┘                            └─────────┬──────────────────────────────────┘
           │                                                │
           │            in-process MCP tools (server "redteam"), all run in the PARENT node process
           │   recon_probe · list_knowledge · get_knowledge · send_to_target · self_check ·
           │   record_finding · register_invention · submit_report
           │                                                │
           └────────────────────────┬───────────────────────┘
                                     │  ctx = shared RunContext { target, knowledge, RunLog, budget, reporter }
                                     ▼
                         ┌───────────────────────────┐         ┌──────────────────────────────┐
                         │  TargetClient (fetch)      │ ──────► │  TARGET agent (HTTP endpoint) │
                         │  Bearer key, OpenAI-shape  │ ◄────── │  (e.g. deepseek/gpt via gateway)│
                         └───────────────────────────┘         └──────────────────────────────┘
                                     │
                                     ▼  RunLog (findings, threads, decisions, inventions, transcript)
                         mapRunLogToReport() → writeAutonomousReport() → report.html + report.json
```

**Two independent channels:**

- **Brain** = Claude Agent SDK (`query()`), talks to Claude via `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`.
- **Target** = plain `fetch` to the target's HTTP endpoint with its own `TARGET_API_KEY`.

The agent model **never sees either key** — tools hold the `TargetClient` instance, not the key string.

---

## 2. The three agents

| Agent           | Model (default) | Role                                                                                     | Tools granted                                                                                                        |
| --------------- | --------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Commander**   | `opus`          | Orchestrates: recon → plan → dispatch → synthesize. Does NOT attack directly.            | recon_probe, list/get_knowledge, record_finding, register_invention, submit_report, self_check, **Agent** (dispatch) |
| **Recon**       | `haiku`         | Benign fingerprinting only (role, guardrails, refusal style). Never attacks.             | recon_probe, list_knowledge                                                                                          |
| **Attacker** ×N | `sonnet`        | Owns ONE vuln class; runs the adaptive multi-turn attack; self-judges; records findings. | list/get_knowledge, send_to_target, self_check, record_finding, register_invention                                   |

Subagents are SDK `options.agents`. The commander spawns attackers by emitting **multiple
`Agent` tool calls in one turn** → they run **in parallel**, each on its own thread namespace.

---

## 3. The 8 custom tools (in-process MCP server "redteam")

| Tool                 | Who                 | What it does                                                                                                                      |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `recon_probe`        | recon, commander    | Send a **benign** probe to the target; log under recon (capped by `--max-recon-probes`).                                          |
| `list_knowledge`     | all                 | List seed vuln-classes / personas / strategies (the menu).                                                                        |
| `get_knowledge`      | commander, attacker | Fetch one seed's full detail — incl. the **fail/pass rubric** used for self-judging.                                              |
| `send_to_target`     | attacker            | The attack channel. Maintains per-thread history; enforces `--max-thread-turns`; tags persona/strategy + decision.                |
| `self_check`         | commander, attacker | OPTIONAL independent **second-model** verdict (`--verify`). Never a gate.                                                         |
| `record_finding`     | attacker, commander | Log a confirmed vuln. **Evidence guard**: rejects unless the quote is a verbatim substring of a real target reply on that thread. |
| `register_invention` | attacker, commander | Log a NOVEL persona/strategy the agent invented (optionally persisted back to the seed library).                                  |
| `submit_report`      | commander           | Final action: attach the narrative synthesis, mark the run complete.                                                              |

Tool ids are `mcp__redteam__<name>`. Handlers run in the **parent** process and close over the shared `RunContext`.

---

## 4. Seed knowledge — _seeds, not scripts_

Loaded from `data/` (override with `--seed-dir`). Each is YAML-frontmatter `.md`. **None contain
binding attack prompts** — they describe _what to look for_, _who to be_, _how to pressure_.

```
data/
  vuln-classes/*.md   # id, severity, standards(OWASP), description, fail_rubric, pass_rubric, inspiration?
  personas/*.md       # id, name, voice, traits, when_to_use
  strategies/*.md     # id, name, mechanics, when_to_use, escalation_notes
```

The agent reads them as a **starting menu** and is explicitly told to improvise, blend, and
**invent new ones** (`register_invention`). `--persist-inventions` writes accepted inventions back
as new seed files, so the library compounds over runs.

> Note: these are the autonomous package's OWN seeds (8 vuln-classes), authored fresh. The 66 opfor
> `evaluators/agent/*.md` are **not** used.

---

## 5. The adaptive loop (this is the "intelligence")

The judging + attacking doctrine lives in the **system prompts** (`prompts/commander.ts`,
`prompts/attacker.ts`), so the agent reasons holistically rather than being gated by rigid code.

```
ATTACKER, per thread:
  ┌────────────────────────────────────────────────────────────────┐
  │ 1. get_knowledge(vulnClass)  → load fail/pass rubric             │
  │ 2. craft message (persona + strategy)                            │
  │ 3. send_to_target(threadId, prompt, persona, strategy, decision) │
  │ 4. read reply → SELF-JUDGE against the rubric                    │
  │ 5. decide:                                                       │
  │     • CONTINUE  – partial signal / target wavering               │
  │     • ESCALATE  – defended but a seam is visible                 │
  │     • PIVOT     – hard refusal repeated ~2× → new persona/strat  │
  │     • STOP      – clear success (record) or robust defense       │
  │ 6. on success → (optional self_check) → record_finding(evidence) │
  └───────────────────────────────┬─────────────────────────────────┘
            loop until success / dead thread / thread-turn cap
```

Every turn records a `decisionAction` + `decisionRationale` → the report's **decision log**.
The `(persona/strategy)` tag changing between turns _is_ a pivot/escalation happening live.

---

## 6. State model

```
RunContext (shared, in parent)
 ├─ options          AutoOptions (models, caps, budget, flags)
 ├─ target           TargetClient (fetch wrapper, holds key)
 ├─ knowledge        KnowledgeBase (vulnClasses, personas, strategies)
 ├─ budget           BudgetGuard (thread-turn cap, USD ceiling, rate token-bucket)
 ├─ reporter         live-log emitter
 └─ runLog ───────── RunLog (source of truth for the report)
        ├─ recon[]            benign probes + responses
        ├─ fingerprint        set by submit_report
        ├─ threads Map<id, ThreadState{ history[], turns[], vulnClassId }>
        ├─ findings[]         confirmed vulns (verdict, severity, evidence, reasoning)
        ├─ inventions[]       novel personas/strategies
        ├─ decisions[]        continue/escalate/pivot/stop log
        ├─ transcript[]       raw tool-call audit (from hooks)
        ├─ selfChecks Map     2nd-model corroborations
        └─ synthesis          executive narrative (from submit_report)
```

**Thread isolation:** each attacker uses a distinct `threadId`; per-thread `history` is replayed
to stateless targets, so concurrent attackers never cross-contaminate.

---

## 7. Capture → report pipeline

Two capture layers feed the RunLog:

1. **Tool handlers** write semantic events (turns, findings, recon, inventions, synthesis) — the source of truth.
2. **PostToolUse hook** writes a raw audit transcript (every tool call + `agent_id`) and narrates subagent dispatch.

Then:

```
RunLog ──mapRunLogToReport()──► AutonomousReport ──writeAutonomousReport()──► report.html + report.json
```

- Confirmed findings → grouped; attempted-but-defended threads → PASS rows; error-only → ERROR rows.
- `summary` = threads / confirmed / defended / errors / attackSuccessRate.
- Severity → per-turn score (drives the score-evolution sparkline).
- Report also carries: recon fingerprint, persona timeline, decision log, strategies used, inventions, recommendations.

---

## 8. Safety, resilience, cost

- **Credential separation:** Claude key (SDK) vs target key (TargetClient) vs verifier key — never mixed; never shown to the model.
- **Child-env sanitization** (`buildChildEnv`): strips inherited `CLAUDECODE*` session markers so, when run inside Claude Code/Cursor, the child SDK uses the configured gateway key (not the parent's).
- **Evidence guard:** `record_finding` rejects any quote not found verbatim in a real target reply → blocks hallucinated findings.
- **Resilience:** a mid-run failure (provider usage-policy block, network) is caught → the run finalizes a **partial report** from whatever's already in the RunLog (never loses captured findings).
- **Cost ceilings:** SDK `--max-turns`, per-thread `--max-thread-turns`, hard `--budget-usd`; rate token-bucket + 429 backoff.

---

## 9. Module map

```
src/
  index.ts                 CLI entry (commander, dotenv)
  commands/auto.ts         flag parsing → AutoOptions → run → live log file + write report
  orchestrator/
    run.ts                 builds RunContext + agents + tools + hooks; drives query(); maps report
    context.ts             RunContext type + snip() helper
  target/http.ts           standalone fetch client (stateless/stateful, Bearer, 429, error sentinels)
  knowledge/
    types.ts               VulnClass / Persona / Strategy
    load.ts                parse data/*.md ; persist inventions
  tools/
    server.ts              createSdkMcpServer("redteam") + tool-name constants
    reconProbe / knowledge / sendToTarget / selfCheck / recordFinding / registerInvention / submitReport
    util.ts                jsonResult / textResult
  prompts/
    commander.ts           commander doctrine (mission, lifecycle, persona/decision/self-judge rules)
    attacker.ts            attacker loop doctrine
    recon.ts               benign-recon doctrine
    digest.ts              renders the seed catalog into the prompt
  state/
    runLog.ts              RunLog / ThreadState / Finding / evidence guard
    hooks.ts               PostToolUse → transcript + dispatch narration; ProgressReporter
  report/
    types.ts               AutonomousReport
    mapRunLog.ts           RunLog → AutonomousReport
    html.ts                self-contained HTML renderer
    writeReport.ts         writes report.{html,json}
  lib/
    types.ts               AutoOptions / TargetConfig
    budget.ts              BudgetGuard
data/                      seed vuln-classes / personas / strategies
tests/                     knowledge loader, evidence guard, report mapping, http client
```

---

## 10. End-to-end sequence (one run)

1. CLI parses flags → `AutoOptions`; builds `TargetConfig`; opens a live-log file.
2. `runAutonomous()` builds `TargetClient`, loads seed knowledge, creates `RunLog` + `BudgetGuard` + `RunContext`.
3. Builds the `redteam` MCP server, the recon/attacker subagent defs, and the PostToolUse hooks.
4. Calls `query()` with the commander system prompt, `permissionMode: bypassPermissions`, sanitized child env.
5. **Commander** runs recon (benign probes) → fingerprints the target.
6. Commander picks vuln classes vs the objective → **dispatches attacker subagents in parallel**.
7. Each **attacker** runs the adaptive loop (§5): send → self-judge → decide → record (with evidence guard).
8. Tool handlers + hooks stream live lines and accumulate the `RunLog`.
9. Commander (optionally `self_check`s) → `submit_report` with the narrative synthesis.
10. On completion OR mid-run error/budget breach → `mapRunLogToReport()` → `writeAutonomousReport()` → HTML + JSON.

---

## 11. Known limitation (be skeptical of findings)

The **self-judge is currently too generous**: it can mark a _confabulated_ "system prompt" or a
_refused_ injection as a FAIL. The evidence guard proves the quote is real, **not** that it's a true
secret. Hardening in progress: require **cross-session consistency** for system-prompt-leak (same text
across independent threads, not mutually-contradictory guesses) and lean on `--verify` for
independent corroboration. Treat findings as leads to verify, not ground truth.

```

```
