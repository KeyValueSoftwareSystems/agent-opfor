# `@opfor/autonomous` — Architecture

A **Claude-Agent-SDK-native** adaptive red-team agent. Give it a target HTTP endpoint + a free-text
objective; it does its own recon, picks attack vectors, runs adaptive multi-turn attacks that branch
into a tree, **judges itself**, and writes a report. Fully standalone — no `@opfor/core` import.

New devs: read §1–§3 to understand the flow, then jump to the [module map](#module-map).

---

## 1. Two channels (the core mental model)

```
        ┌──────────── opfor-auto (CLI) ────────────┐
        │  flags → AutoOptions → runAutonomous()    │
        └─────────────────────┬─────────────────────┘
                              │ query()  ← Claude Agent SDK
                    ┌─────────▼──────────┐        in-process MCP tools          ┌─────────────────┐
   BRAIN (Claude) ──┤  COMMANDER + sub-  ├── send_to_target / fork / leads ────►│  TargetClient   │──HTTP──► TARGET
   ANTHROPIC_*      │  agents (1 query)  │   record_finding / self_check ...    │  (fetch + key)  │◄──────  agent
                    └─────────┬──────────┘   (all run in the PARENT process,    └─────────────────┘  TARGET_API_KEY
                              │                closing over a shared RunContext)
                              ▼
              RunLog → mapRunLogToReport() → report.html + report.json + run-*.jsonl
```

- **Brain** = the agents, driven by the Claude Agent SDK (`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`).
- **Target** = the system under test, reached by a plain `fetch` client (`TARGET_API_KEY`).
- The agent model **never sees either key** — tools hold the `TargetClient`, not the key string.

---

## 2. The agents (one `query()`, SDK subagents)

| Agent           | Model    | Role                                                                                                                |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| **Commander**   | `opus`   | Orchestrates: recon → plan → dispatch waves → synthesize. Never attacks directly.                                   |
| **Scout** ×1    | `haiku`  | Benign fingerprinting only — classifies the target **archetype** (raw-llm / business-agent / tool-using / rag-bot). |
| **Operator** ×N | `sonnet` | Owns ONE vuln class; runs the adaptive loop, branches, self-judges, records findings.                               |

The commander spawns scout/operators as SDK subagents (the `Agent`/`Task` tool). Multiple in one
turn → run **in parallel**, each on its own `threadId`. Subagents are **run-to-completion**: the
commander only regains control between waves.

---

## 3. How a run explores (the flow)

```
RECON ─ benign probes → archetype + guardrails + weak points
  │
PLAN ─ gate vuln classes to the archetype (drop what can't apply), force-include objective vectors,
  │    rank, take top ≤ maxOperators
  │
WAVE 0 ─ dispatch one operator per chosen vector (parallel) ──┐
  │                                                           │  each operator, per thread:
  │   ┌───────────────────────────────────────────────────┐  │   send_to_target → SELF-JUDGE vs rubric
  │   │  CONTINUE while moving · ESCALATE on a seam ·        │ ◄┘   → CONTINUE / ESCALATE / PIVOT / STOP
  │   │  FORK a promising state · STOP on pivot-exhaustion   │      → record_finding (evidence-guarded)
  │   │  flag_lead promising-but-unfinished seams            │      → flag_lead leftover seams
  │   └───────────────────────────────────────────────────┘
  │
WAVES 1..N ─ commander reads the lead queue (list_leads), ranks by objective signal, expands the
  │          best (top-K, ≤ maxDepth) as focused follow-up operators — CONTINUE a thread or start NEW —
  │          dismisses the rest. Repeat until the queue is dry / maxDepth / budget.
  │
SYNTHESIZE ─ submit_report (narrative + recommendations) → write report
```

**Branching (the "tree").** Two mechanisms:

- **`fork_thread`** (intra-operator, _stateless only_): copy a thread's history up to a seam into a
  child `threadId`, then diverge — explores a new angle without polluting the parent. Lineage is
  tracked (`parentThreadId` / `forkedFromTurn` / `gen`).
- **lead queue** (commander, between waves): `flag_lead` → `list_leads` → spawn follow-ups. This is
  the deliberate, parallel deepening; `gen` counts the generations, bounded by `maxDepth`.

**Stateful vs stateless targets.** Stateless = full history replayed each call (forking is free).
Stateful = `threadId` _is_ the server session id, history held server-side (can't be cloned, so
`fork_thread` is rejected; deepen by continuing the same session). A per-`threadId` `SessionGate`
serializes same-session sends so concurrent operators never corrupt a session.

---

## 4. Judgment & guards (why findings are trustworthy and cheap)

**Judgment** (doctrine lives in the prompts, not rigid code):

- A deterministic **progress signal** (`computeProgressSignal`) — objective reply-similarity +
  refusal detection, weighted over the agent's self-score — drives the diminishing-returns
  CONTINUE/PIVOT/STOP decision. Returned advisory on every `send_to_target`.
- **Evidence guard:** `record_finding` rejects any quote not found verbatim in a real target reply,
  and rejects unknown `vulnClassId`. → no hallucinated or mis-classed findings.
- **Judge-hardening:** `self_check` (`--verify`) is a second-model verdict expected on high/critical;
  `system-prompt-leak` needs cross-session consistency; identity confabulation ≠ a leak.
- **Dedup-as-corroboration:** same-evidence findings merge; if they came from _independent_ threads,
  the merged finding is marked cross-session-corroborated (confidence boost).

**Cost / runaway guards** (the wallet, not the steering):

- `--budget-usd` hard USD ceiling (best-effort, post-result) + **`--max-total-sends`** — a
  _deterministic_, real-time send cap (the backstop the lagging USD signal can't give).
- `--max-thread-turns` (per-lineage depth ceiling), `--max-total-threads` (tree size),
  `--max-forks-per-thread` (fan-out), `--max-depth` (generations), rate token-bucket + 429 backoff.
- On any mid-run error/budget breach the run still finalizes a **partial report** from the RunLog.

---

## 5. State & output

**`RunContext`** (shared, in the parent process) wires every tool handler to:
`options · target · knowledge · budget · sessionGate · reporter · runLog`.

**`RunLog`** is the source of truth: `recon[]`, `fingerprint`, `threads Map<id, ThreadState>`
(history, turns, lineage, gen), `findings[]`, `leads[]`, `decisions[]`, `inventions[]`,
`transcript[]`, `selfChecks`, `synthesis`.

**Output** (in `--output`): `report.html` (executive report — verdict, severity bar, vuln-class
matrix, attack tree, per-finding conversations), `report.json`, `auto-live-*.log` (streamed
progress + counts + tree), `run-*.jsonl` (structured event trail).

---

## 6. Seeds — _seeds, not scripts_

`data/` holds 9 vuln-classes + personas + strategies as YAML-frontmatter `.md`. **None contain
binding prompts** — vuln-classes describe _what to look for_ + a fail/pass **rubric**; personas
_who to be_; strategies _how to pressure_. The agent reads them as a starting menu and is told to
improvise, blend, and **invent** new ones (`register_invention`, optionally persisted).

---

## 7. Module map

```
src/
  index.ts              CLI entry (commander + dotenv)
  commands/auto.ts      flags → AutoOptions → runAutonomous → live-log + JSONL + report
  orchestrator/
    run.ts              builds RunContext + agents + tools + hooks; drives query(); maps report
    context.ts          RunContext type + snip()
  target/http.ts        fetch client (stateless replay / stateful session, 429, error sentinels)
  knowledge/            types.ts (VulnClass/Persona/Strategy) · load.ts (parse data/, persist inventions)
  tools/                server.ts (MCP "redteam") + one file per tool:
                          reconProbe · knowledge (list/get) · sendToTarget · forkThread · getThread
                          · flagLead · listLeads · selfCheck · recordFinding · registerInvention · submitReport
  prompts/              commander.ts · operator.ts · scout.ts · digest.ts (doctrine + seed catalog)
  state/
    runLog.ts           RunLog/ThreadState/Finding/SeamLead · evidence guard · fork/lineage · progress signal
    observe.ts          RunEvent + counts line + ASCII attack-tree renderers
    hooks.ts            PostToolUse audit transcript + ProgressReporter (onLine/onEvent)
  report/               types.ts (AutonomousReport) · mapRunLog.ts · html.ts · writeReport.ts
  lib/                  types.ts (AutoOptions/TargetConfig) · budget.ts (BudgetGuard) · sessionGate.ts
data/                   9 vuln-classes · personas · strategies
tests/                  knowledge, evidence guard, fork/lineage, leads/budget, progress, report, http
```

---

## 8. Known limitations (be skeptical of findings)

- The self-judge can still over-claim on borderline cases (e.g. a policy the bot is allowed to state
  counted as a leak). Treat findings as **leads to verify**, not ground truth; use `--verify`.
- A budget-truncated run loses the executive synthesis (findings are still captured).
- Brain calls have no timeout — a slow gateway can stall a run (no graceful-shutdown finalizer yet).
- Lead-spawned follow-ups aren't drawn as tree branches (the tree shows forks + counts the leads).

```

```
