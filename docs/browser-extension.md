# Opfor — Browser Extension

The no-code red-team path. Install the extension, open any chat interface, click the icon, pick a suite, watch it run. Aimed at PMs, QA, designers, and security analysts — anyone who can't or won't open a terminal.

Everything runs **client-side in your browser**. The extension uses your own LLM API keys; nothing is sent to an opfor backend.

> Currently covers **agent / chatbot red-teaming**. For MCP server red-teaming, use the [CLI](cli.md) or [MCP server tool](mcp.md).

---

## What it does

- Auto-detects the chat widget on any web page (custom UIs, Intercom, Zendesk, Drift, Salesforce, etc.)
- Types attack prompts into the chat as if you were typing them; watches responses
- Judges each response with an LLM and scores it pass / fail
- Generates a self-contained HTML report you can download and share

Same evaluator catalog as the CLI — see [evaluators reference](evaluators.md).

![Run in progress](assets/screenshots/extension-run-progress.png) <!-- TODO: screenshot -->

---

## Install

1. Open the [OPFOR listing on the Chrome Web Store](https://chromewebstore.google.com/).
2. Click **Add to Chrome**.
3. Pin the OPFOR icon to your toolbar.

![Install from Chrome Web Store](assets/screenshots/extension-webstore-install.png) <!-- TODO: screenshot -->

Works in any Chromium browser (Chrome, Edge, Brave, Arc). Firefox listing pending.

### Development install (from source)

For contributors or testing unreleased changes:

```bash
git clone https://github.com/KeyValueSoftwareSystems/opfor.git
cd opfor/extension
npm install
npm run build:catalog
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `opfor/extension/` folder.

---

## Configure LLM profiles

The extension uses **three LLM roles**, all configured in the popup settings panel and stored in `chrome.storage.local` on your machine:

| Role            | What it does                                                     |
| --------------- | ---------------------------------------------------------------- |
| **Attacker**    | Generates adversarial prompts per turn                           |
| **Judge**       | Scores the transcript pass / fail                                |
| **HTML reader** | Parses page snapshots to locate the chat input and response area |

Each role accepts any OpenAI-compatible provider — OpenAI, Groq, Anthropic via proxy, LiteLLM, OpenRouter, Ollama, etc. Set `baseUrl`, `model`, and `apiKey` per role.

![Settings panel](assets/screenshots/extension-settings.png) <!-- TODO: screenshot -->

> Use cheap, fast models for **attacker** and **HTML reader**. Use the strongest model you can afford for **judge** — verdict quality drives report accuracy.

---

## Run a scan

1. Open the chat interface you want to test in a browser tab.
2. Click the OPFOR icon.
3. Pick a suite (e.g. `owasp-llm-top10`) or specific evaluators — same IDs as the CLI; see [evaluators reference](evaluators.md).
4. Click **Start**.
5. Watch the run log — the attacker types into the chat, the target replies, the judge scores each evaluator.
6. Click **Download report** when done.

![Suite picker](assets/screenshots/extension-suite-picker.png) <!-- TODO: screenshot -->

![Report download](assets/screenshots/extension-report.png) <!-- TODO: screenshot -->

The extension runs up to **20 turns per evaluator** (default 10). It stops a given evaluator early when the judge returns a definitive verdict.

---

## What it tests

Same agent-redteam catalog as the CLI (six suites, ~50 evaluators). Pick by suite or by individual evaluator ID. Full reference: [evaluators.md](evaluators.md).

| Suite                     | Best for                                                    |
| ------------------------- | ----------------------------------------------------------- |
| `owasp-llm-top10`         | Prompt injection, jailbreaks, sensitive disclosure          |
| `owasp-agentic-ai`        | Goal hijack, tool misuse, identity / memory poisoning       |
| `owasp-api`               | BOLA, BFLA, PII via API tool calls                          |
| `eu-ai-act-bias`          | Demographic bias (age, gender, race, disability)            |
| `output-trust-and-safety` | Hallucination, sycophancy, off-topic drift, ASCII smuggling |

---

## Limitations

- **Chat-widget targets only.** The extension needs a detectable chat input + response area in the DOM. Standalone API endpoints and non-chat agents → use the [CLI](cli.md).
- **No MCP / live tool-call evaluators.** The judge sees the transcript, not real tool side-effects. For MCP server red-teaming use the CLI's `mode: "mcp"` or the [MCP server tool](mcp.md).
- **One agent per run.** No cross-agent or inter-agent communication tests.
- **Vendor closed shadow-DOM widgets** (Salesforce, some Intercom builds) may need a vendor-specific fallback — open an issue with a sample URL if auto-detect fails.
- **No pause / resume across sessions.** Run state lives in `chrome.storage.local`; uninstalling the extension wipes it.

---

## Privacy

- LLM API keys are stored in `chrome.storage.local` and **never leave your browser**. No opfor-hosted backend.
- Attack prompts and target responses are sent to **the LLM providers you configure** (OpenAI / Groq / etc.) — same data path as if you'd used the CLI on your own machine.
- The extension does not phone home.

---

## Roadmap

- Firefox Add-ons listing
- Multi-turn session persistence across browser restarts
- MCP server red-team mode in-browser
- Manual selector hints for closed-shadow chat widgets
