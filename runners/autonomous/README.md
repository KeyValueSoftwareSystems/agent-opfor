# @opfor/autonomous

A Claude-Agent-SDK-native adaptive red-team agent: give it a target endpoint + an objective,
and it runs its own recon, picks attack vectors, branches a multi-turn attack tree, self-judges,
and writes a report. See [ARCHITECTURE.md](./ARCHITECTURE.md) for how it works.

## Setup

```bash
nvm use 24            # Node 24
npm install           # (from the OPFOR workspace root)
cp .env.sample .env    # then fill in ANTHROPIC_API_KEY (+ TARGET_API_KEY if the target needs auth)
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
Run `npm run dev -- auto --help` for all flags.

### Common flags

- `--endpoint <url>` (required), `--target-model <id>`, `--objective <text>` / `--objective-file <path>`
- `--target-key <key>` (or `TARGET_API_KEY`), `--header "K: V"` (repeatable)
- Target shape: `--stateless` (default, OpenAI messages) · custom JSON `--prompt-path`/`--response-path` · `--stateful --session-field <name>`
- Models: `--model` (commander, opus) · `--attacker-model` (sonnet) · `--recon-model` (haiku) · `--verify` (2nd-model judge)
- Bounds: `--budget-usd 10` (cost backstop; 0 = unlimited) · `--max-attackers` · `--max-depth` · `--max-leads-per-wave` · `--max-thread-turns` · `--max-total-threads` · `--max-forks-per-thread`
- `--output <dir>` (default `.opfor/reports`) · `--env <path>`

## Output (in `--output`)

- `report.html` / `report.json` — final report incl. the **Attack Tree**
- `auto-live-*.log` — live progress (`tail -f` it); shows the running counts + final tree
- `run-*.jsonl` — structured event trail (machine-readable)

## Test

```bash
npm run typecheck && npm test
```
