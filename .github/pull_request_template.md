## What changed and why

<!-- Required: explain what this PR does and the motivation behind it. -->

## Type of change

- [ ] `feat` — new evaluator, suite, transport, or feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` — no behavior change
- [ ] `chore` — deps, tooling, CI
- [ ] `test` — adding or updating tests

## Checklist

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build:catalog:check` passes _(if evaluators or suites changed)_
- [ ] Tested against a local target _(if evaluator added or changed)_
- [ ] No secrets, `.env`, or `.opfor/` artifacts committed
- [ ] PR title follows `<type>: <what changed>` — e.g. `feat: add SSRF evaluator`

## Evaluator checklist _(skip if no evaluator added)_

- [ ] `id` is unique across all evaluators
- [ ] `pass_criteria` and `fail_criteria` are specific, not vague
- [ ] `severity` matches actual risk (`critical` = RCE / data breach)
- [ ] `standards` mapping is correct
- [ ] `.test.yaml` fixture included
