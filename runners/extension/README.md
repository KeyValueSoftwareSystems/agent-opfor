# Opfor browser extension

Chrome/Brave MV3 extension for **red-teaming embedded web chat agents**.

## Adaptive runner (main flow)

1. Locates the chat widget (frames + shadow-aware snapshots), picks input/send via LLM.
2. For each **user round** (default **10**):
   - LLM (attacker profile) generates the **next user message** using: evaluator patterns + site snapshot + full transcript so far.
   - Sends it → waits → extracts assistant text from the page.
3. After all rounds, a **judge** LLM call scores the **full transcript** (`verdict`, `summary`, `findings`, `score`).

Tune **User rounds**, **Wait after send**, and evaluator in the popup.

## Options

Open extension **Options** and configure three OpenAI-compatible LLM profiles:

| Profile         | Role                                                |
| --------------- | --------------------------------------------------- |
| **Attacker**    | Generates adversarial messages each turn            |
| **Judge**       | Scores the final transcript (PASS / FAIL / UNKNOWN) |
| **HTML reader** | Picks the chat input from DOM snapshots             |

Each profile needs: base URL, model name, API key, enabled toggle.

## Load unpacked

`chrome://extensions` → Developer mode → Load unpacked → select `extension/`.

> No build step required. The manifest uses `"type": "module"` so Chrome loads the
> ES modules directly from source.

## Module structure

The service worker is split into focused ES modules loaded via native `import`:

| File                   | Responsibility                                                            |
| ---------------------- | ------------------------------------------------------------------------- |
| `service_worker.js`    | Entry point — message routing only                                        |
| `orchestrator.js`      | Main run loop: locate → attack → extract → judge                          |
| `llmUiActions.js`      | DOM-specific LLM helpers (attack/judge prompts now live in `@opfor/core`) |
| `domTarget.js`         | Wraps the DOM send/extract path as a core `AgentTarget`                   |
| `dist/core.bundle.js`  | Browser bundle of `@opfor/core` (attack + judge engine)                   |
| `chatLocator.js`       | LLM-driven chat widget detection using accessibility tree snapshots       |
| `frameDiscovery.js`    | Frame collection, scoring, and chat-frame selection                       |
| `domActions.js`        | DOM interaction via `chrome.scripting.executeScript`                      |
| `responseExtractor.js` | Smart polling extractor for bot responses                                 |
| `storage.js`           | `chrome.storage.local` read/write helpers                                 |
| `catalog.js`           | `catalog.json` loading and evaluator/suite lookups                        |
| `config.js`            | LLM profile loading from Options storage                                  |
| `state.js`             | Shared mutable run state (`OPFOR_STOP`, abort controller)                 |
| `utils.js`             | `sleep`, `formatTranscript`, `safeJsonParse`                              |
| `frame_*.js`           | Frame scripts injected into page contexts (standalone, no imports)        |
| `popup.js`             | Extension popup UI                                                        |

Frame scripts (`frame_*.js`) are injected via `chrome.scripting.executeScript()` into page
contexts and **cannot use ES module imports** — they remain standalone files.
