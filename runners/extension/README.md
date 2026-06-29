# OPFOR Browser Extension

Chrome/Brave MV3 extension for **red-teaming embedded web chat agents**.

## How It Works

1. **Locates the chat widget** on the page using LLM-driven accessibility tree analysis (handles iframes and shadow DOM).
2. **Runs adaptive attacks** — for each round (default 10):
   - The attacker LLM generates an adversarial message using: evaluator patterns + site context + conversation history.
   - Sends it to the chat widget → waits for response → extracts the assistant's reply from the DOM.
3. **Judges the transcript** — after all rounds, a judge LLM scores the full conversation (`PASS` / `FAIL` / `UNKNOWN`) with summary and findings.

## Installation

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `runners/extension/` folder

> No build step required for development. The manifest uses `"type": "module"` so Chrome loads ES modules directly.

## Configuration

All configuration is done in the **popup UI**:

### Main Settings

- **Security Suite** — Select a predefined suite (e.g., OWASP LLM Top 10) or "Custom Evaluators" to pick individual tests
- **Evaluators** — Expand to select/deselect specific evaluators. Use the search box to filter.
- **Provider** — Choose your LLM provider (OpenAI, Anthropic, Google, Groq, DeepSeek, Azure, or Custom/OpenAI-compatible)
- **Model** — Select or enter the model name
- **API Key** — Your API key for the selected provider

### Advanced Settings (gear icon)

- **Turns per attack** — Number of adversarial messages before judging (1-20, default 10)
- **Wait after send** — Seconds to wait for bot response (3-30s)
- **Message length limit** — Max characters per attack message
- **Agent description** — Manual description of the chat agent (fallback when auto-detect fails)
- **Attack objective** — Custom objective to guide the attacker LLM
- **Business use case** — Additional context about the target agent
- **Custom evaluator hint** — Extra guidance for the judge LLM

## Running a Test

1. Navigate to a page with a chat widget
2. Click the OPFOR extension icon
3. Select a suite and evaluators
4. Configure your LLM provider and API key
5. Click **Execute**

The extension will:

- Detect the chat widget on the page
- Run the selected evaluators
- Display real-time attack/response bubbles
- Show the final verdict when complete

## Module Structure

| File                   | Responsibility                                                                |
| ---------------------- | ----------------------------------------------------------------------------- |
| `service_worker.js`    | Entry point — message routing                                                 |
| `orchestrator.js`      | Main run loop: locate → attack → extract → judge                              |
| `chatLocator.js`       | LLM-driven chat widget detection using accessibility tree                     |
| `frameDiscovery.js`    | Frame collection, scoring, and chat-frame selection                           |
| `domTarget.js`         | Wraps DOM send/extract as a core `AgentTarget`                                |
| `domActions.js`        | DOM interaction via `chrome.scripting.executeScript`                          |
| `responseExtractor.js` | Smart polling extractor for bot responses                                     |
| `llmUiActions.js`      | DOM-specific LLM helpers                                                      |
| `llm.js`               | Direct LLM API calls for extension context                                    |
| `agentContext.js`      | Resolves agent business context from page content                             |
| `catalog.js`           | `catalog.json` loading and evaluator/suite lookups                            |
| `config.js`            | LLM profile loading from storage                                              |
| `storage.js`           | `chrome.storage.local` read/write helpers                                     |
| `state.js`             | Shared mutable run state (`OPFOR_STOP`, abort controller)                     |
| `providers.js`         | LLM provider configurations                                                   |
| `utils.js`             | Utility functions (`sleep`, `formatTranscript`, etc.)                         |
| `popup.js`             | Extension popup UI logic                                                      |
| `sidepanel-*.js`       | Side panel UI components                                                      |
| `dist/core.bundle.js`  | Browser bundle of `@keyvaluesystems/agent-opfor-core` (attack + judge engine) |
| `frame_*.js`           | Frame scripts injected into page contexts (standalone, no imports)            |

Frame scripts (`frame_*.js`) are injected via `chrome.scripting.executeScript()` into page contexts and **cannot use ES module imports** — they remain standalone files.

## Building the Core Bundle

If you modify core library code, rebuild the browser bundle:

```bash
cd runners/extension
node scripts/bundle-core.mjs
```

This creates `dist/core.bundle.js` from `core/src/browser.ts`.
