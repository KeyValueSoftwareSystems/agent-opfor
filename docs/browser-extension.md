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

<img src="assets/screenshots/extension-run-progress.png" alt="Run in progress" width="320">

---

## Install

1. Open the [OPFOR listing on the Chrome Web Store](https://chromewebstore.google.com/detail/blkflfeicejfnbecanjaolbllmoobenp).
2. Click **Add to Chrome**.
3. Pin the OPFOR icon to your toolbar.

Works in any Chromium browser (Chrome, Edge, Brave, Arc). Firefox listing pending.

### Development install (from source)

For contributors or testing unreleased changes:

```bash
git clone https://github.com/KeyValueSoftwareSystems/agent-opfor.git
cd opfor
npm install
npm run build:catalog --workspace=@keyvaluesystems/agent-opfor-extension
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `runners/extension/` folder.

---

## Configure LLM

The extension uses a **single LLM configuration** for all operations (attack generation, judgment, and HTML parsing), configured in the popup and stored in `chrome.storage.local` on your machine.

### Main settings

| Setting      | Description                                                                     |
| ------------ | ------------------------------------------------------------------------------- |
| **Provider** | OpenAI, Anthropic, Google, Groq, DeepSeek, Azure, or Custom (OpenAI-compatible) |
| **Model**    | Model name (dropdown shows common options, or type your own)                    |
| **API Key**  | Your API key for the selected provider                                          |

<img src="assets/screenshots/extension-settings.png" alt="Settings panel" width="320">

### Advanced settings (gear icon)

| Setting                   | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| **Turns per attack**      | Number of adversarial messages before judging (1-20, default 10)       |
| **Wait after send**       | Seconds to wait for bot response (3-30s)                               |
| **Message length limit**  | Max characters per attack message                                      |
| **Agent description**     | Manual description of the chat agent (fallback when auto-detect fails) |
| **Attack objective**      | Custom objective to guide the attacker LLM                             |
| **Business use case**     | Additional context about the target agent                              |
| **Custom evaluator hint** | Extra guidance for the judge LLM                                       |

> For best results, use a capable model like GPT-4o or Claude Sonnet. Verdict quality depends on the model's reasoning ability.

---

## Run a scan

1. Open the chat interface you want to test in a browser tab.
2. Click the OPFOR icon.
3. Pick a **Security Suite** (e.g. OWASP LLM Top 10) or select "Custom Evaluators" to pick individual tests.
4. Configure your **Provider**, **Model**, and **API Key**.
5. Click **Execute**.
6. Watch the run — the attacker types into the chat, the target replies, real-time bubbles show the conversation.
7. When complete, view the verdict and **Download report**.

<img src="assets/screenshots/extension-suite-picker.png" alt="Suite picker" width="280"> <img src="assets/screenshots/extension-report.png" alt="Report download" width="280">

The extension runs up to **20 turns per evaluator** (default 10). It stops a given evaluator early when the judge returns a definitive verdict.

---

## What it tests

Same agent-redteam catalog as the CLI. Pick by suite or select "Custom Evaluators" to choose individual tests. Full reference: [evaluators.md](evaluators.md).

| Suite                     | Best for                                                    |
| ------------------------- | ----------------------------------------------------------- |
| `owasp-llm-top10`         | Prompt injection, jailbreaks, sensitive disclosure          |
| `owasp-agentic-ai`        | Goal hijack, tool misuse, identity / memory poisoning       |
| `owasp-mcp-top10`         | MCP-specific vulnerabilities                                |
| `eu-ai-act-bias`          | Demographic bias (age, gender, race, disability)            |
| `output-trust-and-safety` | Hallucination, sycophancy, off-topic drift, ASCII smuggling |
| `harmful-content`         | CBRN, malicious code, violence, self-harm, radicalization   |
| `mitre-atlas`             | MITRE ATLAS adversarial ML techniques                       |
| `pre-deploy-critical`     | Highest-severity failure modes for pre-deployment gates     |
| `quick-smoke`             | Fast sanity check with key evaluators                       |

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
