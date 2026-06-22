# Opfor — Skills

Opfor ships Skills (markdown instruction files an AI coding agent reads and follows) for both agent and MCP server red-teaming. Install once, then trigger from chat inside your project.

---

## Install

Run this from the **root of the project you want to test** (the agent scans the repo, so context matters):

```bash
npx skills add https://github.com/KeyValueSoftwareSystems/OPFOR.git
```

The CLI walks you through a short wizard: pick which agent to install into (Claude Code, Cursor, Windsurf, Gemini CLI, GitHub Copilot, etc.) and which skills (`opfor-setup`, `opfor-run`, or both — pick both). Skills land in your agent's skills directory (e.g. `.claude/skills/opfor-setup/` for Claude Code; path varies per agent).

---

## What you get

Two skill bundles, each with setup + execute:

| Skill             | What the agent does                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opfor-setup`     | Scans the repo (endpoints, `opfor.config*`, `.env`, telemetry SDK imports), asks only what's still unknown, picks a suite or evaluators, writes a config under `.opfor/configs/`. |
| `opfor-run`       | Loads the config, fires attack prompts at the target, runs the LLM-as-judge, writes an HTML + JSON report, and summarises findings in chat.                                       |
| `opfor-mcp-setup` | Scans the repo (mcp.json, docker configs, server source), collects transport + command/URL, picks a suite, writes an MCP config under `.opfor/configs/`.                          |
| `opfor-mcp-run`   | Fires tool-call attacks at the MCP server, judges JSON-RPC responses, writes report.                                                                                              |

Flow: `opfor-setup` → `opfor-run`. Run setup once per target; re-run it whenever you want a fresh report.

---

## Trace-aware

`opfor-setup` auto-detects Langfuse / Netra / OpenTelemetry usage by scanning `opfor.config*`, `.env*`, `package.json`, Docker / Helm files, and app code for SDK imports and exporters. If traces are wired, the agent grounds attack prompts in real production flows and (when supported) configures trace-ID propagation so the judge sees the full target trace per attack. No manual telemetry block needed unless something is ambiguous.

---

## Prerequisites

- An API key for an LLM provider in your shell or `.env` — `GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`. The agent reads `.env` from the project root.
- A reachable target — HTTP endpoint or a local script. The agent will ask for it on first setup if not found in the repo.

---

## Usage from chat

Inside your IDE chat, just say:

```
Set up an Opfor assessment for this project.     # triggers opfor-setup
Run the Opfor assessment.                        # triggers opfor-run
```

For MCP server targets:

```
Set up an Opfor MCP assessment for this server.  # triggers opfor-mcp-setup
Run the Opfor MCP assessment.                    # triggers opfor-mcp-run
```

---

## Update / remove

```bash
npx skills update opfor-setup opfor-run
npx skills remove opfor-setup opfor-run
```
