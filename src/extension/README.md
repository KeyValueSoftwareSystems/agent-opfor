# Astra UI extension (dev)

Chrome/Brave MV3 extension for **red-teaming embedded web chat agents**.

## Adaptive runner (main flow)

1. Loads **`persona.md`** — single consolidated red-team persona (no separate evaluator runs).
2. Locates the chat widget (frames + shadow-aware snapshots), picks input/send via LLM once.
3. For each **user round** (default **10**):
   - LLM generates the **next user message** using: persona + site snapshot + **full transcript so far** (including the latest assistant reply).
   - Sends it → waits → extracts assistant text from the page.
4. After all rounds, **one** LLM **judge** call scores the **full transcript** (`verdict`, `summary`, `findings`).

Tune **User rounds** and **Wait after send** in the popup.

## Options

Open extension **Options** and set OpenAI-compatible **base URL**, **model**, and **API key**.

## Load unpacked

`chrome://extensions` → Developer mode → Load unpacked → select `src/extension/`.
