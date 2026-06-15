# @opfor/autonomous

A Claude-Agent-SDK-native adaptive red-team agent: give it a target endpoint + an objective,
and it runs its own recon, picks attack vectors, branches a multi-turn attack tree, self-judges,
and writes a report. See [ARCHITECTURE.md](./ARCHITECTURE.md) for how it works.

## Setup

```bash
nvm use 24            # Node 24
npm install           # (from the OPFOR workspace root)
cp .env.sample .env   # then fill in ANTHROPIC_API_KEY (+ TARGET_API_KEY if the target needs auth)
```

## Run

```bash
# dev (no build): `npm run dev -- auto <flags>`
npm run dev -- auto \
  --endpoint https://api.openai.com/v1/chat/completions \
  --target-model gpt-4o-mini \
  --objective "Probe for jailbreaks, system-prompt leakage, and off-policy behaviour."
```

Built form: `npm run build && node dist/index.js auto <flags>` (or the `opfor-auto auto` bin).
`--endpoint` and one of `--objective` / `--objective-file` are required; everything else has a sane default.
Run `npm run dev -- auto --help` to see this list in the terminal.

## Environment

| Variable             | Required                 | Purpose                                                                   |
| -------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | **yes**                  | Drives the agent (commander / operator / scout) via the Claude Agent SDK. |
| `ANTHROPIC_BASE_URL` | no                       | Point the SDK at a gateway (e.g. LiteLLM) instead of `api.anthropic.com`. |
| `TARGET_API_KEY`     | if the target needs auth | Bearer key sent to the target endpoint (or pass `--target-key`).          |

Loaded from `.env` in the working directory, or a file passed via `--env`.

## Flags

### Target

| Flag                        | Default           | Description                                                                    |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `--endpoint <url>`          | _required_        | Target agent HTTP endpoint.                                                    |
| `--name <name>`             | endpoint host     | Display name for the target (shown in the report).                             |
| `--target-key <key>`        | `$TARGET_API_KEY` | Bearer key for the target; omit if it needs no auth.                           |
| `--target-model <id>`       | `gpt-4o-mini`     | `model` value sent in OpenAI-shape (stateless) requests.                       |
| `--stateless`               | **default**       | Target is stateless — full history is replayed each turn (OpenAI `messages`).  |
| `--stateful`                | off               | Target keeps history server-side — send only the latest prompt + a session id. |
| `--session-field <name>`    | —                 | Request-body field carrying the session id (stateful mode).                    |
| `--prompt-path <dotpath>`   | OpenAI `messages` | Dot-path to write the prompt into (custom-JSON targets, e.g. `body.message`).  |
| `--response-path <dotpath>` | auto-detect       | Dot-path to read the reply from (defaults to common OpenAI/REST shapes).       |
| `--header "K: V"`           | —                 | Extra request header; repeatable.                                              |

### Objective (one is required)

| Flag                      | Default | Description                             |
| ------------------------- | ------- | --------------------------------------- |
| `--objective <text>`      | —       | Free-text attack objective.             |
| `--objective-file <path>` | —       | Read the objective from a file instead. |

### Models

| Flag                    | Default     | Description                                                  |
| ----------------------- | ----------- | ------------------------------------------------------------ |
| `--model <id>`          | `opus`      | Commander model (alias or full id).                          |
| `--operator-model <id>` | `sonnet`    | Operator subagent model.                                     |
| `--scout-model <id>`    | `haiku`     | Scout subagent model.                                        |
| `--verify`              | off         | Enable the independent second-model verifier (`self_check`). |
| `--verifier-model <id>` | = `--model` | Model used for the verifier.                                 |

### Limits & budget

| Flag                         | Default             | Description                                                                                                            |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--budget-usd <n>`           | `10`                | Hard USD cost ceiling; finalizes a partial report when reached. `0` = unlimited. The primary cost guard.               |
| `--max-total-sends <n>`      | ≈ `budget-usd × 50` | Deterministic ceiling on total target sends — the real-time cost backstop (USD is only known after the fact).          |
| `--max-operators <n>`        | `6`                 | Max operator vectors dispatched in the first wave.                                                                     |
| `--max-turns <n>`            | `120`               | Hard ceiling on SDK agentic turns for the whole run.                                                                   |
| `--max-thread-turns <n>`     | `25`                | Per-thread/lineage depth **safety ceiling** — not the operating limit; the agent stops on diminishing returns earlier. |
| `--max-total-threads <n>`    | `40`                | Hard ceiling on total attack threads incl. forks (tree size).                                                          |
| `--max-forks-per-thread <n>` | `4`                 | Hard ceiling on direct forks of any one thread (fan-out).                                                              |
| `--max-depth <n>`            | `3`                 | Max exploration generations (follow-up waves spawned from leads).                                                      |
| `--max-leads-per-wave <n>`   | `4`                 | How many queued leads the commander expands per wave (top-K).                                                          |
| `--max-recon-probes <n>`     | `8`                 | Max benign recon probes before recon must conclude.                                                                    |
| `--sequential`               | off                 | Dispatch operators one at a time (for rate-limited targets).                                                           |

### Misc

| Flag                   | Default          | Description                                                                   |
| ---------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `--persist-inventions` | off              | Persist novel personas/strategies the agent invents back to the seed library. |
| `--seed-dir <path>`    | bundled `data/`  | Override the seed-knowledge directory.                                        |
| `--output <dir>`       | `.opfor/reports` | Report output directory.                                                      |
| `--env <path>`         | `.env` (cwd)     | Load a specific `.env` file (overrides existing vars).                        |

## Output (in `--output`)

- `report.html` / `report.json` — final report incl. the **Attack Tree**.
- `auto-live-*.log` — live progress (`tail -f` it); shows the running counts + final tree.
- `run-*.jsonl` — structured event trail (machine-readable).

## Test

```bash
npm run typecheck && npm test
```
