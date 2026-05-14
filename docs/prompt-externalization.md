# Prompt Externalization Plan

## Current state

LLM prompts live in two places today:

| Kind                                                              | Where                                       | External?              |
| ----------------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| Attack templates (patterns, pass/fail criteria)                   | `skills/*/evaluators/*.md` YAML frontmatter | **Yes — already done** |
| Framework prompts (judge rubric, attacker persona, UI automation) | Hardcoded in `.ts` / `.js` source files     | **No**                 |

The framework prompts are never centralized — the same scoring rubric is implemented independently in `core/src/evaluators/judge.ts` (used by CLI/MCP) and `extension/llmPlanner.js` (used by the browser extension). Same for the attacker persona prompt: three separate inline implementations across `core/src/run/generateNextMcpAttackTurn.ts`, `core/src/lib/agent.ts`, and `extension/llmPlanner.js`.

---

## What to externalize and what to leave alone

Not every prompt benefits from externalization. The decision criterion:

> **Externalize** if the prompt is: (a) shared across multiple code files, OR (b) a "strategy document" that product/security people need to iterate on without touching source code.
>
> **Leave inline** if the prompt is: a short glue prompt tightly coupled to one function's input/output contract.

### Externalize (3 prompts)

#### 1. `judge-rubric` — the security scoring rubric

Currently duplicated between:

- `core/src/evaluators/judge.ts:33-94` — `JUDGE_SYSTEM` constant (~60 lines)
- `extension/llmPlanner.js:~286-320` — inline system prompt in `judgeConversationFinal`

These are not identical — the extension version adds multi-turn transcript handling while the core version covers single-turn agent responses. Both share the same 3-step scoring rubric (scope check → quick pass → scoring checklist). Externalizing lets both surfaces load the same base rubric and each add their context section programmatically.

**File**: `skills/shared/prompts/judge-rubric.md`

#### 2. `attacker-persona` — the adaptive multi-turn attacker

Currently split across:

- `extension/llmPlanner.js:~145-215` — `llmNextUserMessage` system prompt (~72 lines): domain-aware attacker with escalation ladder
- `core/src/run/generateNextMcpAttackTurn.ts:13-36` — `ATTACKER_SYSTEM` (~24 lines): MCP-specific turn generator
- `core/src/lib/agent.ts:232-243` — inline 1-liner for HTTP agent mode

The extension version is the most developed (domain detection, 9-turn escalation ladder, tone matching). The core versions are simplified subsets. A single canonical attacker persona would prevent the three from drifting further.

**File**: `skills/shared/prompts/attacker-persona.md`

#### 3. `attack-plan-generator` — MCP attack plan generation

Located only in `core/src/attacks/generatePlan.ts:49-159` (~110 lines). This is not duplicated, but it is the longest and most complex prompt in the codebase — it contains the 8 adversarial strategies, the JSON output contract, and the judge-hint guidelines. It reads like a spec document and should be versioned separately from the code it drives.

**File**: `skills/shared/prompts/attack-plan-generator.md`

### Leave inline (10+ prompts)

| Prompt                        | Location                                  | Reason to keep inline                             |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Frame input picker            | `llmPlanner.js:aiPickInputInFrame`        | Tightly coupled to JSON output schema; not shared |
| UI action planner             | `llmPlanner.js:aiUiNextAction`            | Same — action enum maps directly to code branches |
| Chat reset detector           | `orchestrator.js:resetChatSession`        | Single-call, never reused                         |
| Message shortener             | `llmPlanner.js:llmShortenMessage`         | 4 lines, trivial                                  |
| Tool relevance scorer         | `generatePlan.ts:computeToolRelevanceMap` | Utility function, not a strategy                  |
| Attack prompt template filler | `generatePrompts.ts`                      | Tightly coupled to evaluator `.md` loading        |
| Single-shot attack agent      | `agent.ts:runAttackAgent`                 | 1-line system prompt                              |

---

## File format

Use the same `.md` + YAML frontmatter pattern already established for evaluators. The body of the file is the raw prompt text (no markdown escaping needed — the loader reads the body as a plain string).

```markdown
---
schema_version: 1
id: judge-rubric
name: Security Scoring Rubric
role: system
description: >-
  Judges AI agent and chatbot responses against security evaluator criteria.
  Three-step rubric: scope check → quick pass → scoring checklist (0–10 scale).
---

You are a strict security evaluator for AI chatbot and agent responses...

━━━ STEP 1 · SCOPE CHECK ━━━
...
```

**Fields**:

- `id` — matches filename without `.md`; used as the lookup key in code
- `role` — `"system"` or `"user"` (so callers know which messages array slot to put it in)
- `description` — one line; shown in diffs and changelogs
- Body — the literal prompt text, no escaping

---

## Directory layout

```
skills/
├── shared/
│   └── prompts/
│       ├── judge-rubric.md
│       ├── attacker-persona.md
│       └── attack-plan-generator.md
├── agent-redteaming/
│   └── opfor-setup/
│       ├── evaluators/
│       └── suites/
└── mcp-redteaming/
    ├── evaluators/
    └── suites/
```

`skills/shared/prompts/` is parallel to `skills/agent-redteaming/` and `skills/mcp-redteaming/` — it holds resources that both surfaces use.

---

## Loading strategy

### In `core/` (TypeScript)

Add `core/src/config/loadSharedPrompt.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter"; // already used for evaluator parsing
import { z } from "zod";
import { getOpforSetupRoot } from "./skillsLayout.js";

const PromptFrontmatterSchema = z.object({
  schema_version: z.literal(1),
  id: z.string(),
  name: z.string(),
  role: z.enum(["system", "user"]),
  description: z.string().optional(),
});

const promptCache = new Map<string, { role: "system" | "user"; content: string }>();

export function loadSharedPrompt(id: string): { role: "system" | "user"; content: string } {
  if (promptCache.has(id)) return promptCache.get(id)!;

  const root = getOpforSetupRoot(); // resolves skills/ regardless of CWD
  const filePath = join(root, "..", "shared", "prompts", `${id}.md`);
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  const meta = PromptFrontmatterSchema.parse(data);
  const result = { role: meta.role, content: content.trim() };
  promptCache.set(id, result);
  return result;
}
```

Usage in `judge.ts`:

```typescript
// Before:
const JUDGE_SYSTEM = `You are a strict security evaluator...`;

// After:
import { loadSharedPrompt } from "../config/loadSharedPrompt.js";
const { content: JUDGE_SYSTEM } = loadSharedPrompt("judge-rubric");
```

### In `extension/` (browser, no Node.js)

Add `extension/prompts.js` — a thin async loader using `fetch`:

```javascript
const promptCache = new Map();

export async function loadSharedPrompt(id) {
  if (promptCache.has(id)) return promptCache.get(id);

  const url = chrome.runtime.getURL(`skills/shared/prompts/${id}.md`);
  const raw = await fetch(url).then((r) => r.text());

  // Parse YAML frontmatter (--- delimited)
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Prompt file ${id}.md missing frontmatter`);

  const body = match[2].trim();
  const meta = Object.fromEntries(
    match[1]
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [k, ...rest] = line.split(": ");
        return [k.trim(), rest.join(": ").trim()];
      })
  );

  const result = { role: meta.role ?? "system", content: body };
  promptCache.set(id, result);
  return result;
}
```

The extension already uses `chrome.runtime.getURL()` for catalog.json — this follows the same pattern.

**`manifest.json` update** — add the `skills/shared/prompts/` directory to `web_accessible_resources`:

```json
{
  "web_accessible_resources": [
    {
      "resources": ["skills/shared/prompts/*.md"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

---

## Migration order

Do these in sequence — each step is independently shippable.

### Step 1 — Create the directory and files

Create `skills/shared/prompts/` with the three `.md` files. No code changes yet. This is a pure content commit and gets the prompts into version control where they can be reviewed and iterated on.

**Files to create**:

- `skills/shared/prompts/judge-rubric.md` (content from `core/src/evaluators/judge.ts` JUDGE_SYSTEM)
- `skills/shared/prompts/attacker-persona.md` (content from `extension/llmPlanner.js` llmNextUserMessage system prompt — the most developed version)
- `skills/shared/prompts/attack-plan-generator.md` (content from `core/src/attacks/generatePlan.ts` buildSystemPrompt)

### Step 2 — Wire the core loader

Add `core/src/config/loadSharedPrompt.ts`. Update three files to use it:

- `core/src/evaluators/judge.ts` — replace `JUDGE_SYSTEM` constant
- `core/src/attacks/generatePlan.ts` — replace `buildSystemPrompt()`
- `core/src/run/generateNextMcpAttackTurn.ts` — replace `ATTACKER_SYSTEM`

Run `npm run build && npm run typecheck` to verify.

### Step 3 — Wire the extension loader

Add `extension/prompts.js`. Update `extension/llmPlanner.js`:

- `judgeConversationFinal` — load `judge-rubric`, append the multi-turn context section programmatically
- `llmNextUserMessage` — load `attacker-persona`, inject evaluator-specific variables

Update `manifest.json` web_accessible_resources. Load extension unpacked and smoke-test.

### Step 4 — Unify the diverged judge prompts

After Step 2 and Step 3 both load from the same `judge-rubric.md`, audit the differences between the core version and the extension version. Merge them: the base rubric stays in the `.md` file; surface-specific sections (multi-turn transcript context for extension, single-turn for core) are appended at call time before the LLM call.

---

## What this is NOT

- Not a prompt management system / prompt registry — no versioning UI, no deployment pipeline. Just files on disk.
- Not a template engine — `{{placeholder}}` variables in evaluator patterns are already handled by `generatePrompts.ts`. The framework prompts don't use template variables; dynamic content (evaluator criteria, transcripts) is appended as a separate user message, not interpolated into the system prompt.
- Not a migration of all 40+ prompts — only the 3 that are shared or strategy-level. The rest stay inline where they are most readable.

---

## Why not YAML for the prompt body?

YAML multiline strings (`|` or `>`) introduce indentation sensitivity and escape requirements that make long prompts painful to edit. The `.md` frontmatter approach (YAML metadata + plain text body) is already used for evaluators here and is the better fit — the body reads as normal prose/markdown without any YAML quoting concerns.

---

## Effort estimate

| Step                               | Scope                 | Estimated effort |
| ---------------------------------- | --------------------- | ---------------- |
| Step 1: Create prompt files        | Content only, no code | 1–2 hours        |
| Step 2: Core loader + wire-up      | ~4 files changed      | 2–3 hours        |
| Step 3: Extension loader + wire-up | ~3 files changed      | 2–3 hours        |
| Step 4: Unify judge prompts        | Analysis + merge      | 1–2 hours        |
| **Total**                          |                       | **6–10 hours**   |
